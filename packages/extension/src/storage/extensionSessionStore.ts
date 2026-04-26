import type { ExtensionSessionState, ExtensionUser } from "../recorder/types";

const SESSION_KEY = "om_ext_sess_v1";
const CRYPTO_KEY_STORAGE = "om_ext_crypto_v1";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromB64(s: string): ArrayBuffer {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAesKey(): Promise<CryptoKey> {
  const { [CRYPTO_KEY_STORAGE]: existing } = await chrome.storage.local.get(CRYPTO_KEY_STORAGE) as { [k: string]: string | undefined };
  if (existing) {
    return crypto.subtle.importKey("raw", fromB64(existing), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const exp = await crypto.subtle.exportKey("raw", key);
  await chrome.storage.local.set({ [CRYPTO_KEY_STORAGE]: toB64(exp) });
  return key;
}

async function seal(plain: string): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(utf8(plain));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    data as globalThis.BufferSource,
  );
  const merged = new Uint8Array(iv.length + ct.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(ct), iv.length);
  return toB64(merged.buffer);
}

async function unseal(packed: string): Promise<string> {
  const key = await getAesKey();
  const raw = fromB64(packed);
  const iv = new Uint8Array(raw, 0, 12);
  const data = new Uint8Array(raw, 12);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(data) as globalThis.BufferSource,
  );
  return new TextDecoder().decode(pt);
}

export type StoredExtensionSessionV1 = {
  user: ExtensionUser;
  status: ExtensionSessionState["status"];
  clientKind: "browser_extension";
  sealedRefresh: string;
  lastRefreshedAt?: string;
};

export async function readStoredSession(): Promise<StoredExtensionSessionV1 | null> {
  const { [SESSION_KEY]: raw } = await chrome.storage.local.get(SESSION_KEY) as { [k: string]: StoredExtensionSessionV1 | undefined };
  if (!raw || !raw.sealedRefresh || !raw.user?.id)
    return null;
  return raw;
}

export async function persistSession(state: {
  user: ExtensionUser;
  status: ExtensionSessionState["status"];
  refreshToken: string;
}): Promise<void> {
  const sealedRefresh = await seal(state.refreshToken);
  const payload: StoredExtensionSessionV1 = {
    user: state.user,
    status: state.status,
    clientKind: "browser_extension",
    sealedRefresh,
    lastRefreshedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [SESSION_KEY]: payload });
}

export async function readRefreshToken(): Promise<string | null> {
  const s = await readStoredSession();
  if (!s)
    return null;
  try {
    return await unseal(s.sealedRefresh);
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
}
