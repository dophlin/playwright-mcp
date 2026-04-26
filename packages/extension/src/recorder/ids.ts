export function randomId(): string {
  if (globalThis.crypto?.randomUUID)
    return globalThis.crypto.randomUUID();
  return `om_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
