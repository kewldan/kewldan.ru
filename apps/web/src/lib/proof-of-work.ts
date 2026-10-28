/**
 * The contact form's proof of work: find `nonce` so that
 * `sha256("{id}:{nonce}")` starts with `difficulty` zero bits (the API's
 * `contact.rs`). About a second of CPU, spent in a worker while the visitor
 * types.
 */
const SOURCE = `
const zeros = (b) => { let n = 0; for (const x of b) { if (x === 0) { n += 8; continue; } return n + Math.clz32(x) - 24; } return n; };
self.onmessage = async ({ data: { id, difficulty } }) => {
  const enc = new TextEncoder();
  for (let base = 0; ; base += 512) {
    const hashes = await Promise.all(
      Array.from({ length: 512 }, (_, k) => crypto.subtle.digest("SHA-256", enc.encode(id + ":" + (base + k)))),
    );
    const hit = hashes.findIndex((h) => zeros(new Uint8Array(h)) >= difficulty);
    if (hit >= 0) return self.postMessage(String(base + hit));
  }
};`;

export function solve(id: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = (e: MessageEvent<string>) => {
      resolve(e.data);
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.postMessage({ id, difficulty });
  });
}
