import type { ActivateRecorderMessage } from "./contentScriptBridge";

type Ctx = Pick<ActivateRecorderMessage, "clientRecordingId" | "startWallMs" | "voicePreference">;

let current: Ctx | null = null;

export function setRecorderActivationContext(
  o: { clientRecordingId: string; startWallMs: number; voicePreference: Ctx["voicePreference"] } | null,
): void {
  if (!o) {
    current = null;
    return;
  }
  current = {
    clientRecordingId: o.clientRecordingId,
    startWallMs: o.startWallMs,
    voicePreference: o.voicePreference
  };
}

export function getRecorderActivationContext(): Ctx | null {
  return current;
}
