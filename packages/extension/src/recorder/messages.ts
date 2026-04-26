import type { OpenMateRecordingEvent, SkillMetadataDraft, SensitivitySnapshot } from "./types";

export type OpenMateErrorEnvelope = {
  code: string;
  message: string;
};

export type OpenMateResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: OpenMateErrorEnvelope };

export type OpenMateRequest =
  | { type: "openmate.auth.receiveHandoff"; code: string; source?: string }
  | { type: "openmate.auth.getStatus" }
  | { type: "openmate.auth.refresh" }
  | { type: "openmate.auth.signOutLocal" }
  | {
    type: "openmate.recording.start";
    voicePreference: "prompt" | "on" | "off";
    activeTabId: number;
  }
  | {
    type: "openmate.recording.event";
    clientRecordingId: string;
    event: OpenMateRecordingEvent;
  }
  | {
    type: "openmate.recording.attachNote";
    clientRecordingId: string;
    text: string;
    tabId: number;
    timestampMs: number;
  }
  | {
    type: "openmate.recording.takeScreenshot";
    clientRecordingId: string;
    tabId: number;
    timestampMs: number;
  }
  | { type: "openmate.recording.stopForReview"; clientRecordingId: string }
  | {
    type: "openmate.recording.submit";
    clientRecordingId: string;
    metadata: SkillMetadataDraft;
  }
  | { type: "openmate.recording.retryUpload"; clientRecordingId: string }
  | {
    type: "openmate.recording.discard";
    clientRecordingId: string;
    confirmed: boolean;
  }
  | { type: "openmate.ping" };

export function isOpenMateRequest(message: unknown): message is OpenMateRequest {
  if (!message || typeof message !== "object" || !("type" in message))
    return false;
  const t = (message as { type: unknown }).type;
  return typeof t === "string" && t.startsWith("openmate.");
}

export function err<T = never>(code: string, message: string): OpenMateResponse<T> {
  return { ok: false, error: { code, message } };
}

export function ok<T>(data: T): OpenMateResponse<T> {
  return { ok: true, data };
}

export type SensitivityForTransport = SensitivitySnapshot;
