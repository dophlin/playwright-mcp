import {
  OpenMateExtensionRecorder,
  RecorderOperationError,
  type RecorderOutput,
  type RecorderSafeError,
  type RecorderSnapshot,
  type RecorderStatus,
  type StartRecordingInput,
  type StopRecordingInput
} from "@openmate/extension-recorder";
import { recorderConstructionOptions } from "./recorderConstants";

const SESSION_MIRROR_KEY = "om_recorder_session_snapshot_v1";

let instance: OpenMateExtensionRecorder | null = null;
let staleSessionCleared: RecorderSafeError | null = null;

function getOrCreateRecorder(): OpenMateExtensionRecorder {
  if (!instance) {
    instance = new OpenMateExtensionRecorder(recorderConstructionOptions);
  }
  return instance;
}

export function takeStaleSessionError(): RecorderSafeError | null {
  const e = staleSessionCleared;
  staleSessionCleared = null;
  return e;
}

export async function onRecorderServiceWorkerStartup(): Promise<void> {
  const { [SESSION_MIRROR_KEY]: raw } = await chrome.storage.session.get(SESSION_MIRROR_KEY) as {
    [SESSION_MIRROR_KEY]?: string;
  };
  if (!raw) {
    return;
  }
  let parsed: RecorderSnapshot;
  try {
    parsed = JSON.parse(raw) as RecorderSnapshot;
  } catch {
    await chrome.storage.session.remove(SESSION_MIRROR_KEY);
    return;
  }
  if (parsed.status === "active" || parsed.status === "stopping") {
    getOrCreateRecorder().discard();
    await chrome.storage.session.remove(SESSION_MIRROR_KEY);
    staleSessionCleared = {
      code: "recording_not_active",
      message: "Recording was interrupted when the extension background was restarted. The session was discarded.",
      recoverability: "recoverable"
    };
  }
}

export async function mirrorSnapshotToSession(): Promise<void> {
  const r = getOrCreateRecorder();
  const snap = r.snapshot();
  try {
    await chrome.storage.session.set({ [SESSION_MIRROR_KEY]: JSON.stringify(snap) });
  } catch {
    /* ignore quota / private mode */
  }
}

function toUiSafeError(e: RecorderSafeError): {
  code: string;
  message: string;
  recoverable: boolean;
  validationIssueIds?: string[];
} {
  return {
    code: e.code,
    message: e.message,
    recoverable: e.recoverability === "recoverable",
    ...(e.validationIssueIds ? { validationIssueIds: e.validationIssueIds } : {})
  };
}

export function startRecording(input: StartRecordingInput):
  | { ok: true; data: ReturnType<OpenMateExtensionRecorder["start"]> }
  | { ok: false; error: ReturnType<typeof toUiSafeError> } {
  const r = getOrCreateRecorder();
  try {
    const data = r.start(input);
    void mirrorSnapshotToSession();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof RecorderOperationError) {
      return { ok: false, error: toUiSafeError(e) };
    }
    throw e;
  }
}

export function stopRecording(input?: StopRecordingInput):
  | { ok: true; data: RecorderOutput }
  | { ok: false; error: ReturnType<typeof toUiSafeError> } {
  const r = getOrCreateRecorder();
  try {
    const data = r.stop(input);
    void mirrorSnapshotToSession();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof RecorderOperationError) {
      return { ok: false, error: toUiSafeError(e) };
    }
    throw e;
  }
}

export function discardRecording(): void {
  getOrCreateRecorder().discard();
  void mirrorSnapshotToSession();
}

export function getRecorderSnapshot(): RecorderSnapshot {
  return getOrCreateRecorder().snapshot();
}

export function getRecorderStatus(): RecorderStatus {
  return getOrCreateRecorder().status;
}

/**
 * Adapters and handlers use this to forward browser signals; call `afterRecorderMutation` after each call.
 */
export function getOpenMateRecorder(): OpenMateExtensionRecorder {
  return getOrCreateRecorder();
}

export function afterRecorderMutation(): void {
  void mirrorSnapshotToSession();
}
