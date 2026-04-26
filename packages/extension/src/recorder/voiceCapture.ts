import type { VoicePreference, VoiceStatus } from "./types";

export function initialVoiceState(pref: VoicePreference, micGranted: boolean | null): VoiceStatus {
  if (pref === "off")
    return "off";
  if (pref === "on")
    return micGranted ? "on" : "unavailable";
  if (pref === "prompt")
    return "prompting";
  return "unknown";
}

export function transitionAfterPermissionAnswer(
  current: VoiceStatus,
  granted: boolean,
): VoiceStatus {
  if (current === "prompting")
    return granted ? "on" : "off";
  return current;
}
