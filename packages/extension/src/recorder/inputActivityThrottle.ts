const THROTTLE_MS = 400;
let lastInputBroadcastAt = 0;

/** Returns true if this input event should be broadcast to the panel (throttled). */
export function shouldBroadcastInputActivity(): boolean {
  const n = Date.now();
  if (n - lastInputBroadcastAt < THROTTLE_MS)
    return false;
  lastInputBroadcastAt = n;
  return true;
}

export function resetInputActivityThrottle(): void {
  lastInputBroadcastAt = 0;
}
