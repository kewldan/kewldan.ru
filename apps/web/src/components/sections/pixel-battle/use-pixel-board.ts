"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PixelClientMessage } from "@/lib/api/generated/PixelClientMessage";
import type { PixelServerMessage } from "@/lib/api/generated/PixelServerMessage";

export const WIDTH = 64;
export const HEIGHT = 32;
export const CELLS = WIDTH * HEIGHT;
export const EMPTY = -1;

/** Used only until the server's `hello` arrives, or when offline. Mirrors apps/api/src/pixels/board.rs. */
const FALLBACK_PALETTE = ["#0d0d0f", "#ffe14d", "#7aa2ff", "#5fe39a", "#ff9a4d", "#2a35ff", "#ff8fd0"];
const FALLBACK_INK = { max: 40, regen: 5 };
const STORAGE_KEY = "kd-pixels";
const FLUSH_MS = 50;

export type Mode = "connecting" | "live" | "offline";
export type Cursor = { x: number; y: number; c: number };
export type Ping = { key: number; i: number; c: number };

/** Board changes for the canvas: a list of cells, or everything. */
type Listener = (cells: number[] | "all") => void;

function socketUrl() {
  const explicit = process.env.NEXT_PUBLIC_PIXELS_WS;
  if (explicit) return explicit;
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/api/pixels/ws`;
}

function decode(board: string, into: Int8Array) {
  for (let i = 0; i < CELLS; i++) {
    const b = board.charCodeAt(i);
    into[i] = b === 46 /* . */ ? EMPTY : b - 48;
  }
}

function loadLocal(into: Int8Array) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(raw) && raw.length === CELLS) into.set(raw);
  } catch {
    /* private mode or junk: start blank */
  }
}

function saveLocal(board: Int8Array) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(board)));
  } catch {
    /* storage full or blocked */
  }
}

/**
 * The shared board over a WebSocket. Painting is optimistic: cells change on
 * screen at once, go out in 50 ms batches, and the server's `ack` rolls back
 * whatever ink did not cover. Without a server it degrades to a board that
 * lives in this browser.
 */
export function usePixelBoard() {
  const board = useRef(new Int8Array(CELLS).fill(EMPTY));
  const listeners = useRef(new Set<Listener>());
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<number, number>());
  const me = useRef<number | null>(null);
  const inkRef = useRef(FALLBACK_INK.max);
  const pingKey = useRef(0);

  const [mode, setMode] = useState<Mode>("connecting");
  const [palette, setPalette] = useState(FALLBACK_PALETTE);
  const [ink, setInk] = useState(FALLBACK_INK.max);
  const [inkCfg, setInkCfg] = useState(FALLBACK_INK);
  const [locked, setLocked] = useState(false);
  const [peers, setPeers] = useState(1);
  const [cursors, setCursors] = useState<Record<number, Cursor>>({});
  const [pings, setPings] = useState<Ping[]>([]);

  const emit = useCallback((cells: number[] | "all") => {
    listeners.current.forEach((l) => l(cells));
  }, []);

  const setInkBoth = (v: number) => {
    inkRef.current = v;
    setInk(v);
  };

  const send = (msg: PixelClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Connection with exponential backoff; offline mode after the first failures.
  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as PixelServerMessage;
      switch (msg.t) {
        case "hello":
          me.current = msg.id;
          decode(msg.board, board.current);
          setPalette(msg.palette);
          setInkCfg({ max: msg.inkMax, regen: msg.inkRegen });
          setLocked(msg.locked);
          setInkBoth(msg.ink);
          setPeers(msg.peers);
          setMode("live");
          emit("all");
          break;
        case "paint": {
          if (msg.by === me.current) break;
          const changed: number[] = [];
          for (const [i, c] of msg.cells) {
            if (pending.current.has(i)) continue;
            board.current[i] = c;
            changed.push(i);
          }
          emit(changed);
          const fresh = changed.slice(0, 6).map((i) => ({ key: ++pingKey.current, i, c: board.current[i] }));
          if (fresh.length) setPings((p) => [...p.slice(-18), ...fresh]);
          break;
        }
        case "ack":
          setInkBoth(msg.ink);
          for (const [i, c] of msg.revert) board.current[i] = c;
          if (msg.revert.length) emit(msg.revert.map(([i]) => i));
          break;
        case "cursor":
          if (msg.id !== me.current) setCursors((cs) => ({ ...cs, [msg.id]: { x: msg.x, y: msg.y, c: msg.c } }));
          break;
        case "gone":
          setCursors((cs) => {
            const rest = { ...cs };
            delete rest[msg.id];
            return rest;
          });
          break;
        case "peers":
          setPeers(msg.n);
          break;
        case "board":
          decode(msg.board, board.current);
          emit("all");
          break;
        case "rules":
          setInkCfg({ max: msg.inkMax, regen: msg.inkRegen });
          setLocked(msg.locked);
          setInkBoth(Math.min(inkRef.current, msg.inkMax));
          break;
      }
    };

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onmessage = onMessage;
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        socket.current = null;
        setCursors({});
        attempt += 1;
        if (attempt >= 2) {
          setMode((m) => {
            if (m !== "offline") {
              loadLocal(board.current);
              emit("all");
            }
            return "offline";
          });
        }
        timer = setTimeout(connect, Math.min(30_000, 500 * 2 ** attempt));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [emit]);

  // Strokes go out in small batches.
  useEffect(() => {
    const id = setInterval(() => {
      if (!pending.current.size) return;
      const cells = Array.from(pending.current) as [number, number][];
      pending.current.clear();
      send({ t: "paint", cells });
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // Local ink refill so the bar moves smoothly; the server stays authoritative.
  useEffect(() => {
    const step = 1000 / inkCfg.regen;
    const id = setInterval(() => {
      if (inkRef.current < inkCfg.max) setInkBoth(inkRef.current + 1);
    }, step);
    return () => clearInterval(id);
  }, [inkCfg]);

  const paint = useCallback(
    (cells: number[], color: number) => {
      if (mode === "connecting" || (mode === "live" && locked)) return;
      const changed: number[] = [];
      for (const i of cells) {
        if (board.current[i] === color || inkRef.current <= 0) continue;
        board.current[i] = color;
        inkRef.current -= 1;
        changed.push(i);
        if (mode === "live") pending.current.set(i, color);
      }
      if (!changed.length) return;
      setInk(inkRef.current);
      emit(changed);
    },
    [mode, locked, emit],
  );

  const strokeEnd = useCallback(() => {
    if (mode === "offline") saveLocal(board.current);
  }, [mode]);

  const clearLocal = useCallback(() => {
    board.current.fill(EMPTY);
    saveLocal(board.current);
    emit("all");
  }, [emit]);

  const moveCursor = useCallback((x: number, y: number, c: number) => send({ t: "cursor", x, y, c }), []);
  const leave = useCallback(() => send({ t: "leave" }), []);

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  return {
    board,
    subscribe,
    mode,
    palette,
    ink,
    inkMax: inkCfg.max,
    /** The admin closed the board: it is shown, not painted. */
    locked: mode === "live" && locked,
    peers,
    cursors,
    pings,
    paint,
    strokeEnd,
    clearLocal,
    moveCursor,
    leave,
  };
}
