"use client";

import type * as CannonNs from "cannon-es";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type * as ThreeNs from "three";
import type { RoomEnvironment as RoomNs } from "three/examples/jsm/environments/RoomEnvironment.js";

type Three = typeof ThreeNs;
type Cannon = typeof CannonNs;
type Room = typeof RoomNs;
type Kind = "9mm" | "762";
type Casing = { body: CannonNs.Body; mesh: ThreeNs.Group; dyingAt?: number };
type Puff = { sprite: ThreeNs.Sprite; born: number };

/** CSS pixels per world unit, and world units per millimetre of brass. */
const PX = 10;
const MM = 0.125;
/**
 * Half-sections in mm, from the middle of the head out to the rim, up the
 * outside and back down the inside: the straight 9×19 Parabellum and the
 * bottlenecked 7.62×39. A repeated point is a sharp edge.
 */
// prettier-ignore
const PROFILE: Record<Kind, [number, number][]> = {
  "9mm": [
    [0, 0], [4.96, 0], [4.96, 0], [4.96, 1.1], [4.96, 1.1], [4.2, 1.5],
    [4.2, 2], [4.96, 2.6], [4.83, 19.15], [4.83, 19.15], [4.45, 19.15],
    [4.45, 19.15], [4.45, 3.2], [4.45, 3.2], [0, 3.2],
  ],
  "762": [
    [0, 0], [5.67, 0], [5.67, 0], [5.67, 1.5], [5.67, 1.5], [4.6, 1.8],
    [4.6, 2.6], [5.62, 3.4], [5, 30.5], [4.3, 32.2], [4.3, 38.7], [4.3, 38.7],
    [3.95, 38.7], [3.95, 38.7], [3.95, 32.2], [4.6, 30.5], [5.2, 4.2],
    [5.2, 4.2], [0, 4.2],
  ],
};
/** Collision cylinders: radius at the mouth and at the head, in mm. */
const HULL: Record<Kind, [number, number]> = { "9mm": [4.83, 4.96], "762": [4.6, 5.6] };
const BRASS: Record<Kind, { color: string; roughness: number }> = {
  "9mm": { color: "#d6a64c", roughness: 0.26 },
  "762": { color: "#c38f3a", roughness: 0.34 },
};

const MAX = 36;
const FADE_MS = 500;
const FOV = 30;
/** How deep the card is: casings scatter this far in front of and behind it. */
const DEPTH = 3;
const GRAVITY = 190;
const FLASH_MS = 70;
const SMOKE_MS = 900;
/** The case leaves the port a beat after the flash. */
const EJECT_DELAY = 25;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function lathe(T: Three, kind: Kind) {
  const points = PROFILE[kind].map(([r, y]) => new T.Vector2(r * MM, y * MM));
  const geometry = new T.LatheGeometry(points, 28);
  const length = PROFILE[kind].reduce((top, [, y]) => Math.max(top, y), 0) * MM;
  geometry.translate(0, -length / 2, 0);
  return { geometry, length };
}

/** A star of a muzzle flash, drawn fresh so no two shots look the same. */
function flashTexture(T: Three) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  g.globalCompositeOperation = "lighter";
  const spikes = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + rand(-0.3, 0.3);
    const len = rand(34, 62);
    const half = rand(0.12, 0.24);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, len);
    grad.addColorStop(0, "rgb(255 250 220 / 1)");
    grad.addColorStop(0.35, "rgb(255 200 90 / 0.9)");
    grad.addColorStop(1, "rgb(255 110 20 / 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a - half) * len * 0.35, Math.sin(a - half) * len * 0.35);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a + half) * len * 0.35, Math.sin(a + half) * len * 0.35);
    g.closePath();
    g.fill();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  core.addColorStop(0, "rgb(255 255 240 / 1)");
  core.addColorStop(0.3, "rgb(255 220 120 / 0.9)");
  core.addColorStop(1, "rgb(255 140 30 / 0)");
  g.fillStyle = core;
  g.fillRect(-64, -64, 128, 128);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function smokeTexture(T: Three) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgb(255 255 255 / 0.9)");
  grad.addColorStop(1, "rgb(255 255 255 / 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(c);
}

/**
 * The range card's background, in 3D: something just above the card fires
 * strings of shots, each a flash and a spent case that tumbles down, rings
 * off the others and settles in a pile behind the text. A click fires a few
 * more. Off screen it pauses; with reduced motion it is a still pile.
 */
function createRange(T: Three, C: Cannon, RoomEnvironment: Room, canvas: HTMLCanvasElement, reduced: boolean) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  // Brass is all reflection: a soft studio for it to mirror.
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  scene.environment = env;
  room.dispose();
  pmrem.dispose();

  const camera = new T.PerspectiveCamera(FOV, 1, 1, 500);
  const sun = new T.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const muzzle = new T.PointLight(0xffb347, 0, 0, 2);
  scene.add(sun, sun.target, muzzle, new T.HemisphereLight(0xffffff, 0x334422, 0.5));

  // Invisible floor and back of the card that only take shadows.
  const floorShade = new T.Mesh(new T.PlaneGeometry(400, DEPTH * 2 + 4), new T.ShadowMaterial({ opacity: 0.3 }));
  floorShade.rotation.x = -Math.PI / 2;
  floorShade.receiveShadow = true;
  const backShade = new T.Mesh(new T.PlaneGeometry(400, 400), new T.ShadowMaterial({ opacity: 0.14 }));
  backShade.position.z = -DEPTH;
  backShade.receiveShadow = true;
  scene.add(floorShade, backShade);

  const shapes = { "9mm": lathe(T, "9mm"), "762": lathe(T, "762") };
  const brass = {
    "9mm": new T.MeshStandardMaterial({ ...BRASS["9mm"], metalness: 1, side: T.DoubleSide }),
    "762": new T.MeshStandardMaterial({ ...BRASS["762"], metalness: 1, side: T.DoubleSide }),
  };
  const primerGeometry = new T.CylinderGeometry(2.2 * MM, 2.2 * MM, 0.05, 20);
  const primer = new T.MeshStandardMaterial({ color: "#c9c4ba", metalness: 1, roughness: 0.4 });

  const flash = new T.Sprite(
    new T.SpriteMaterial({ blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }),
  );
  flash.visible = false;
  const flashes = [flashTexture(T), flashTexture(T), flashTexture(T)];
  const smoke = smokeTexture(T);
  const puffs: Puff[] = Array.from({ length: 6 }, () => {
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: smoke, color: 0xc8c8c0, depthWrite: false, transparent: true, opacity: 0 }),
    );
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, born: -Infinity };
  });
  scene.add(flash);

  const world = new C.World({ gravity: new C.Vec3(0, -GRAVITY, 0), allowSleep: true });
  const metal = new C.Material("brass");
  const ground = new C.Material("ground");
  world.addContactMaterial(new C.ContactMaterial(metal, metal, { friction: 0.25, restitution: 0.3 }));
  world.addContactMaterial(new C.ContactMaterial(metal, ground, { friction: 0.35, restitution: 0.42 }));
  const wall = (x: number, y: number) => {
    const body = new C.Body({ mass: 0, material: ground, shape: new C.Plane() });
    body.quaternion.setFromEuler(x, y, 0);
    world.addBody(body);
    return body;
  };
  const floor = wall(-Math.PI / 2, 0);
  const left = wall(0, Math.PI / 2);
  const right = wall(0, -Math.PI / 2);
  wall(0, 0).position.z = -DEPTH;
  wall(0, Math.PI).position.z = DEPTH;

  const casings: Casing[] = [];
  const pending: { at: number; x: number; y: number; z: number }[] = [];
  let width = 0;
  let height = 0;
  let raf = 0;
  let queued = 0;
  let nextShot = 0;
  let last = 0;
  let flashAt = -Infinity;
  let flashSize = 0;
  let puff = 0;

  const render = () => renderer.render(scene, camera);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    width = w / PX;
    height = h / PX;
    // The card's plane fills the view exactly; the floor sits a little up so
    // casings at the front of the pile are not cut off.
    camera.aspect = w / h;
    camera.position.set(0, 0, height / 2 / Math.tan(((FOV / 2) * Math.PI) / 180));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const floorY = -height / 2 + 1.1;
    floor.position.y = floorY;
    floorShade.position.y = floorY + 0.01;
    left.position.x = -width / 2 + 0.6;
    right.position.x = width / 2 - 0.6;
    sun.position.set(width * 0.25, height * 0.9, 40);
    sun.target.position.set(0, floorY, 0);
    const s = Math.max(width, height) / 2 + 6;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 200 });
    sun.shadow.camera.updateProjectionMatrix();
    render();
  };

  const eject = (now: number, x: number, y: number, z: number, fresh = true) => {
    const kind: Kind = Math.random() < 0.5 ? "9mm" : "762";
    const { geometry, length } = shapes[kind];
    const [top, bottom] = HULL[kind];
    const body = new C.Body({
      mass: kind === "9mm" ? 0.5 : 1,
      material: metal,
      shape: new C.Cylinder(top * MM, bottom * MM, length, 10),
      linearDamping: 0.04,
      angularDamping: 0.06,
      sleepSpeedLimit: 0.4,
      sleepTimeLimit: 0.4,
    });
    body.position.set(x, y, z);
    // Lying across the barrel, and spinning end over end as it leaves.
    body.quaternion.setFromEuler(rand(0, Math.PI * 2), rand(-0.4, 0.4), Math.PI / 2 + rand(-0.3, 0.3));
    if (fresh) {
      body.velocity.set(rand(-17, -6), rand(3, 10), rand(-3, 3));
      body.angularVelocity.set(rand(-6, 6), rand(-6, 6), rand(14, 30) * (Math.random() < 0.5 ? -1 : 1));
    }
    world.addBody(body);

    const mesh = new T.Group();
    const shell = new T.Mesh(geometry, brass[kind]);
    const cap = new T.Mesh(primerGeometry, primer);
    cap.position.y = -length / 2 - 0.015;
    shell.castShadow = shell.receiveShadow = cap.castShadow = true;
    mesh.add(shell, cap);
    scene.add(mesh);
    casings.push({ body, mesh });

    // Past the cap the oldest fade away instead of piling up forever.
    const alive = casings.filter((c) => c.dyingAt === undefined);
    if (alive.length > MAX) {
      const old = alive[0];
      old.dyingAt = now;
      for (const part of old.mesh.children as ThreeNs.Mesh[]) {
        part.material = (part.material as ThreeNs.Material).clone();
        part.material.transparent = true;
      }
    }
  };

  const shoot = (now: number) => {
    const x = width / 2 - rand(4, 7);
    const y = height / 2 - rand(2.6, 3.4);
    const z = rand(-1, 1);
    flashAt = now;
    flashSize = rand(10, 14);
    flash.material.map = flashes[Math.floor(Math.random() * flashes.length)];
    flash.material.rotation = rand(0, Math.PI * 2);
    flash.position.set(x, y, z + 0.5);
    muzzle.position.set(x, y, z + 2);
    const p = puffs[puff++ % puffs.length];
    p.born = now;
    p.sprite.position.set(x, y, z);
    p.sprite.material.rotation = rand(0, Math.PI * 2);
    pending.push({ at: now + EJECT_DELAY, x, y, z });
  };

  const update = (now: number, dt: number) => {
    const t = now - flashAt;
    flash.visible = t < FLASH_MS;
    if (flash.visible) {
      const k = 1 - t / FLASH_MS;
      flash.material.opacity = k;
      flash.scale.setScalar(flashSize * (0.8 + 0.4 * (t / FLASH_MS)));
    }
    muzzle.intensity = t < FLASH_MS * 1.5 ? 2400 * (1 - t / (FLASH_MS * 1.5)) ** 2 : 0;

    for (const p of puffs) {
      const k = (now - p.born) / SMOKE_MS;
      p.sprite.visible = k < 1;
      if (!p.sprite.visible) continue;
      p.sprite.material.opacity = 0.3 * (1 - k);
      p.sprite.scale.setScalar(2 + 7 * k);
      p.sprite.position.y += dt * 2.5;
    }

    for (let i = casings.length - 1; i >= 0; i--) {
      const c = casings[i];
      const fade = c.dyingAt === undefined ? 1 : 1 - (now - c.dyingAt) / FADE_MS;
      if (fade <= 0 || c.body.position.y < -height) {
        world.removeBody(c.body);
        scene.remove(c.mesh);
        if (c.dyingAt !== undefined) {
          for (const part of c.mesh.children as ThreeNs.Mesh[]) (part.material as ThreeNs.Material).dispose();
        }
        casings.splice(i, 1);
        continue;
      }
      if (c.dyingAt !== undefined) {
        for (const part of c.mesh.children as ThreeNs.Mesh[]) (part.material as ThreeNs.Material).opacity = fade;
      }
      const { position: p, quaternion: q } = c.body;
      c.mesh.position.set(p.x, p.y, p.z);
      c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  };

  const frame = (now: number) => {
    if (now >= nextShot) {
      if (queued === 0) queued = 3 + Math.floor(Math.random() * 5);
      shoot(now);
      queued -= 1;
      // A string of shots, then a breath before the next one.
      nextShot = now + (queued > 0 ? rand(130, 240) : rand(1300, 2800));
    }
    while (pending.length && pending[0].at <= now) {
      const { x, y, z } = pending.shift()!;
      eject(now, x, y, z);
    }
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    // Fixed steps keep the pile steady whatever the frame rate.
    world.step(1 / 60, dt, 4);
    update(now, dt);
    render();
    raf = requestAnimationFrame(frame);
  };

  return {
    resize,
    start() {
      if (reduced) {
        // A still pile: drop a handful and let them settle before showing anything.
        if (!casings.length) {
          for (let i = 0; i < 18; i++) {
            eject(0, rand(-width / 2 + 3, width / 2 - 3), -height / 2 + 3 + i * 1.6, rand(-2, 2), false);
          }
          for (let i = 0; i < 600; i++) world.step(1 / 60);
          update(0, 0);
        }
        render();
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
    /** A few shots right now, on top of whatever string is running. */
    fire(n: number) {
      if (reduced) return;
      queued += n;
      nextShot = 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          (o.material as ThreeNs.Material).dispose();
        }
      });
      for (const s of Object.values(shapes)) s.geometry.dispose();
      flash.material.dispose();
      for (const p of puffs) p.sprite.material.dispose();
      for (const t of [...flashes, smoke, env]) t.dispose();
      renderer.dispose();
    },
  };
}

export function Casings() {
  const ref = useRef<HTMLCanvasElement>(null);
  const range = useRef<ReturnType<typeof createRange> | null>(null);
  const inView = useInView(ref, { margin: "120px 0px" });
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const canvas = ref.current;
    if (!inView || !canvas) return;
    let alive = true;
    let observer: ResizeObserver | undefined;
    // The card itself is the trigger: the canvas sits behind its text.
    const card = canvas.parentElement;
    const onDown = () => range.current?.fire(4);

    Promise.all([
      import("three"),
      import("cannon-es"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
    ]).then(([T, C, { RoomEnvironment }]) => {
      if (!alive) return;
      try {
        range.current ??= createRange(T, C, RoomEnvironment, canvas, reduced);
      } catch {
        // No WebGL: the card stays a plain card.
        return;
      }
      const r = range.current;
      r.resize();
      observer = new ResizeObserver(() => r.resize());
      observer.observe(canvas);
      card?.addEventListener("pointerdown", onDown);
      r.start();
    });
    return () => {
      alive = false;
      observer?.disconnect();
      card?.removeEventListener("pointerdown", onDown);
      range.current?.stop();
    };
  }, [inView, reduced]);

  useEffect(
    () => () => {
      range.current?.dispose();
      range.current = null;
    },
    [],
  );

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}
