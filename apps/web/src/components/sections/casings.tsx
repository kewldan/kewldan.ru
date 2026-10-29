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
const MM = 0.14;
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
/** Pale, slightly olive cartridge brass, sRGB 0..1. */
const BRASS: Record<Kind, [number, number, number]> = {
  "9mm": [0.78, 0.66, 0.38],
  "762": [0.72, 0.6, 0.33],
};

const MAX = 36;
const FADE_MS = 500;
const FOV = 30;
const SEGMENTS = 28;
/**
 * Half the depth of the box behind the card: the whole of it is about two
 * case widths, so the cases lie in a shallow tray and pile up flat.
 */
const DEPTH = 1.5;
/** Spawn spread in depth, so a fresh case starts clear of both faces. */
const LANE = DEPTH - 0.85;
const GRAVITY = 190;
const FLASH_MS = 70;
const SMOKE_MS = 900;
/** The case leaves the port a beat after the flash. */
const EJECT_DELAY = 25;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Where each profile point sits along the section, in mm from the head. */
function arcs(kind: Kind) {
  const points = PROFILE[kind];
  const at = [0];
  for (let j = 1; j < points.length; j++) {
    const [r0, y0] = points[j - 1];
    const [r1, y1] = points[j];
    at.push(at[j - 1] + Math.hypot(r1 - r0, y1 - y0));
  }
  return at;
}

function lathe(T: Three, kind: Kind) {
  const profile = PROFILE[kind];
  const geometry = new T.LatheGeometry(
    profile.map(([r, y]) => new T.Vector2(r * MM, y * MM)),
    SEGMENTS,
  );
  // Lathe spaces the texture by point count; space it by distance instead,
  // so wear is not smeared down the long body and crammed into the rim.
  const at = arcs(kind);
  const total = at[at.length - 1];
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i <= SEGMENTS; i++) {
    for (let j = 0; j < profile.length; j++) uv.setY(i * profile.length + j, at[j] / total);
  }
  const length = profile.reduce((top, [, y]) => Math.max(top, y), 0) * MM;
  geometry.translate(0, -length / 2, 0);
  return { geometry, length };
}

/** Seeded value noise that wraps around the case, so no seam shows. */
function noise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  /** `u` goes once around in `cells` cells; `v` is in the same units. */
  const at = (u: number, v: number, cells: number) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const xa = ((x0 % cells) + cells) % cells;
    const xb = (xa + 1) % cells;
    const top = hash(xa, y0) + (hash(xb, y0) - hash(xa, y0)) * fx;
    const bottom = hash(xa, y0 + 1) + (hash(xb, y0 + 1) - hash(xa, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  return (u: number, v: number, cells: number, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    for (let o = 0; o < octaves; o++, cells *= 2, amp /= 2) sum += amp * at(u, v, cells);
    return sum / (1 - 0.5 ** octaves);
  };
}

const ramp = (a: number, b: number, t: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Worn range brass, painted per case type: olive mottling, tarnish blotches
 * and pits, faint lengthwise streaks, grime at the head, powder soot round
 * the mouth, a dark inside and fine scratches. Returns the colour, a packed
 * roughness/metalness map and a bump map.
 */
function brassTextures(T: Three, kind: Kind) {
  const W = 256;
  const H = 512;
  const profile = PROFILE[kind];
  const at = arcs(kind);
  const total = at[at.length - 1];
  const top = profile.reduce((m, [, y]) => Math.max(m, y), 0);
  // Past the lip (the first top point, its repeat, then across) is inside.
  const mouth = profile.findIndex(([, y]) => y === top) + 2;
  // Lengths are in units of the circumference so blotches come out round.
  const round = 2 * Math.PI * profile[1][0];
  const mottle = noise(1);
  const tarnish = noise(2);
  const grain = noise(3);
  const pits = noise(4);

  const color = new ImageData(W, H);
  const orm = new ImageData(W, H);
  const bump = new ImageData(W, H);
  for (let row = 0; row < H; row++) {
    // Canvas rows run top down; the texture's v runs from the head up.
    const s = (1 - (row + 0.5) / H) * total;
    let j = 1;
    while (j < at.length - 1 && at[j] < s) j++;
    const k = at[j] === at[j - 1] ? 0 : (s - at[j - 1]) / (at[j] - at[j - 1]);
    const y = mix(profile[j - 1][1], profile[j][1], k);
    const inside = j > mouth;
    const v = s / round;
    // Soot climbs down from the mouth; grime sits round the rim and groove.
    const soot = inside ? 0 : ramp(top - 7, top, y);
    const grime = inside ? 0 : 1 - ramp(0, 3.5, y);
    for (let col = 0; col < W; col++) {
      const u = col / W;
      const m = mottle(u, v, 3);
      const t = ramp(0.6, 0.78, tarnish(u, v, 5, 3));
      const streak = grain(u, v * 0.04, 70, 2);
      const pit = ramp(0.75, 0.88, pits(u, v, 48, 2));
      const smudge = soot * (0.55 + 0.45 * grain(u, v * 0.3, 9, 3));

      let [r, g, b] = BRASS[kind];
      const shade = 0.82 + 0.3 * m - 0.08 * streak;
      // Olive in the dull patches, warm brown where it has tarnished.
      r = mix(r * shade, 0.5, t * 0.5) * (1 - 0.25 * grime);
      g = mix(g * shade, 0.33, t * 0.5) * (1 - 0.3 * grime);
      b = mix(b * shade * mix(1, 0.85, 1 - m), 0.17, t * 0.5) * (1 - 0.35 * grime);
      [r, g, b] = [mix(r, 0.55, pit * 0.7), mix(g, 0.32, pit * 0.7), mix(b, 0.14, pit * 0.7)];
      [r, g, b] = [mix(r, 0.1, smudge * 0.75), mix(g, 0.085, smudge * 0.75), mix(b, 0.07, smudge * 0.75)];
      if (inside) [r, g, b] = [0.2 * shade, 0.16 * shade, 0.1 * shade];

      let rough = 0.3 + 0.16 * (1 - m) + 0.4 * t + 0.4 * pit + 0.5 * smudge + 0.2 * grime;
      let metal = 1 - 0.3 * t - 0.4 * pit - 0.65 * smudge;
      if (inside) [rough, metal] = [0.85, 0.4];

      const i = (row * W + col) * 4;
      color.data.set([r * 255, g * 255, b * 255, 255], i);
      orm.data.set([255, Math.min(1, rough) * 255, Math.max(0, metal) * 255, 255], i);
      const h = 0.6 + 0.08 * m - 0.35 * pit - 0.05 * streak;
      bump.data.set([h * 255, h * 255, h * 255, 255], i);
    }
  }

  const paint = (data: ImageData, scratch: string) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.putImageData(data, 0, 0);
    // Scratches from the magazine and the ejector, mostly round the case.
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    g.strokeStyle = scratch;
    for (let n = 0; n < 70; n++) {
      const x = next() * W;
      const yy = next() * H;
      const len = 8 + next() * 60;
      const tilt = (next() - 0.5) * (next() < 0.8 ? 0.15 : 2);
      g.lineWidth = 0.5 + next() * 0.8;
      g.globalAlpha = 0.15 + next() * 0.3;
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(x + Math.cos(tilt) * len, yy + Math.sin(tilt) * len);
      g.stroke();
    }
    return c;
  };
  const map = new T.CanvasTexture(paint(color, "#fff4d0"));
  map.colorSpace = T.SRGBColorSpace;
  const surface = new T.CanvasTexture(paint(orm, "#ff4dff"));
  const relief = new T.CanvasTexture(paint(bump, "#000"));
  for (const t of [map, surface, relief]) t.wrapS = T.RepeatWrapping;
  return { map, surface, relief };
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
  const worn = { "9mm": brassTextures(T, "9mm"), "762": brassTextures(T, "762") };
  const brass = {} as Record<Kind, ThreeNs.MeshStandardMaterial>;
  for (const kind of ["9mm", "762"] as const) {
    const { map, surface, relief } = worn[kind];
    brass[kind] = new T.MeshStandardMaterial({
      map,
      roughnessMap: surface,
      metalnessMap: surface,
      // The maps scale these.
      roughness: 1,
      metalness: 1,
      bumpMap: relief,
      bumpScale: 0.6,
      side: T.DoubleSide,
    });
  }
  const primerGeometry = new T.CylinderGeometry(2.2 * MM, 2.2 * MM, 0.05, 20);
  const primer = new T.MeshStandardMaterial({ color: "#a89a74", metalness: 1, roughness: 0.5 });

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
  // The front and back are slick glass: in a tray this shallow any grip
  // there wedges cases on end and they stack into a tower.
  const glass = new C.Material("glass");
  world.addContactMaterial(new C.ContactMaterial(metal, metal, { friction: 0.25, restitution: 0.3 }));
  world.addContactMaterial(new C.ContactMaterial(metal, ground, { friction: 0.35, restitution: 0.42 }));
  world.addContactMaterial(new C.ContactMaterial(metal, glass, { friction: 0, restitution: 0.1 }));
  const wall = (x: number, y: number, material = ground) => {
    const body = new C.Body({ mass: 0, material, shape: new C.Plane() });
    body.quaternion.setFromEuler(x, y, 0);
    world.addBody(body);
    return body;
  };
  const floor = wall(-Math.PI / 2, 0);
  const left = wall(0, Math.PI / 2);
  const right = wall(0, -Math.PI / 2);
  wall(0, 0, glass).position.z = -DEPTH;
  wall(0, Math.PI, glass).position.z = DEPTH;

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
    // The box is the card: its front face fills the view exactly, so a case
    // against the floor, a side or the front glass is never cut off.
    camera.aspect = w / h;
    camera.position.set(0, 0, DEPTH + height / 2 / Math.tan(((FOV / 2) * Math.PI) / 180));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const floorY = -height / 2;
    floor.position.y = floorY;
    floorShade.position.y = floorY + 0.01;
    left.position.x = -width / 2;
    right.position.x = width / 2;
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
    // Lying across the barrel, flat to the card, spinning end over end.
    body.quaternion.setFromEuler(rand(0, Math.PI * 2), rand(-0.12, 0.12), Math.PI / 2 + rand(-0.3, 0.3));
    if (fresh) {
      body.velocity.set(rand(-17, -6), rand(3, 10), rand(-0.6, 0.6));
      body.angularVelocity.set(rand(-8, 8), rand(-1.5, 1.5), rand(14, 30) * (Math.random() < 0.5 ? -1 : 1));
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
    const z = rand(-LANE, LANE);
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
            eject(0, rand(-width / 2 + 3, width / 2 - 3), -height / 2 + 3 + i * 1.6, rand(-LANE, LANE), false);
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
      for (const m of Object.values(brass)) m.dispose();
      for (const t of Object.values(worn).flatMap(Object.values)) t.dispose();
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
