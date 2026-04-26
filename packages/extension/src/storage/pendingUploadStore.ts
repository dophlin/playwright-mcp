import type { PendingUploadState, UploadSlot } from "../recorder/types";

const PENDING_KEY = "om_pending_uploads_v1";

type PendingMap = Record<string, PendingUploadState>;

async function readAll(): Promise<PendingMap> {
  const { [PENDING_KEY]: m } = await chrome.storage.local.get(PENDING_KEY) as { [k: string]: PendingMap | undefined };
  return m && typeof m === "object" ? m : {};
}

export async function savePendingUpload(state: PendingUploadState): Promise<void> {
  const m = await readAll();
  m[state.clientRecordingId] = { ...state, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [PENDING_KEY]: m });
}

export async function getPendingUpload(clientRecordingId: string): Promise<PendingUploadState | null> {
  const m = await readAll();
  return m[clientRecordingId] ?? null;
}

export async function clearPendingUpload(clientRecordingId: string): Promise<void> {
  const m = await readAll();
  delete m[clientRecordingId];
  await chrome.storage.local.set({ [PENDING_KEY]: m });
}

export async function listPendingUploads(): Promise<PendingUploadState[]> {
  return Object.values(await readAll());
}

/**
 * Merges upload slot targets after reissue while preserving the clientRecordingId and backend session identity.
 */
export function mergeReissuedSlots(
  current: UploadSlot[] | undefined,
  incoming: UploadSlot[],
): UploadSlot[] {
  const bySlot = new Map<string, UploadSlot>();
  for (const s of current ?? [])
    bySlot.set(s.slot, s);
  for (const s of incoming)
    bySlot.set(s.slot, s);
  return [...bySlot.values()];
}
