import type { UploadSlot } from "./types";

export async function sha256HexOfBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const asBuffer: BufferSource = data instanceof ArrayBuffer
    ? data
    : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", asBuffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexOfJson(obj: unknown): Promise<string> {
  const s = JSON.stringify(obj);
  const enc = new TextEncoder().encode(s);
  return sha256HexOfBytes(enc);
}

/**
 * Picks the upload target for a logical slot (e.g. "events", "screenshot1").
 */
export function findSlot(slots: UploadSlot[], id: string): UploadSlot | undefined {
  return slots.find(s => s.slot === id);
}
