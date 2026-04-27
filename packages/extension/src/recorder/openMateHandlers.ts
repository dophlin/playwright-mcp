import * as authClient from "../api/authClient";
import type { FetchJsonContext } from "../api/backendClient";
import * as recClient from "../api/recordingClient";
import type { StartSessionResponse } from "../api/recordingClient";
import { clearPendingUpload, getPendingUpload, mergeReissuedSlots, savePendingUpload } from "../storage/pendingUploadStore";
import { clearSession, persistSession, readRefreshToken, readStoredSession } from "../storage/extensionSessionStore";
import { findSlot, sha256HexOfBytes } from "./uploadManifest";
import { isAllowedDashboardPageUrl } from "./env";
import { sendRecorderActivateToTab } from "./contentScriptBridge";
import { broadcastPanelPoke } from "./panelPort";
import { resolveApiBaseUrl, resolveDashboardOrigins } from "./openMateSettings";
import { err, ok, type OpenMateRequest, type OpenMateResponse } from "./messages";
import { isSupportedPageUrl } from "./pageSupportAdapter";
import { assertScreenshotNotBlockedForUrl, dataUrlToBlob } from "./screenshotCapture";
import { initialVoiceState } from "./voiceCapture";
import { captureDomEventFromExtension } from "./domSignalAdapter";
import { attachScreenshotBytes, attachUserNote } from "./attachmentAdapter";
import {
  clearActivityFeed,
  formatOpenMateEventSummary,
  getActivityFeed,
  pushActivitySummary,
  setRecordingStartWall
} from "./activityFeed";
import {
  discardRecording,
  getRecorderSnapshot,
  getRecorderStatus,
  startRecording,
  stopRecording,
  takeStaleSessionError
} from "./recorderHost";
import type { ExtensionUser, OpenMateRecordingEvent, SkillMetadataDraft, UploadSlot, VoiceStatus } from "./types";
import type { RecordingLifecycleStatus } from "./types";

const RECORDER_VERSION_PREFIX = "extension-";
const MIN_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9Yk0AAAAASUVORK5CYII=";

function minPngBuffer(): ArrayBuffer {
  const bin = atob(MIN_PNG_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++)
    u[i] = bin.charCodeAt(i);
  return u.buffer;
}

type SessionCtx = {
  clientRecordingId: string;
  backendSessionId?: string;
  skillId?: string;
  recordingConfigurationVersion?: string;
  status: RecordingLifecycleStatus;
  startedAt: string;
  activeTabId?: number;
  voicePreference: "prompt" | "on" | "off";
  sessionUploadSlots: UploadSlot[];
  voiceStatus: VoiceStatus;
  voiceDurationMs: number;
  lastScreenshotPng?: ArrayBuffer;
  pendingFormDefaults?: { title: string; allowedDomains: string[]; tags: string[] };
  stopSummary?: { stepCount: number; voiceDurationMs: number; typedNoteCount: number; screenshotCount: number };
};

type AppState = {
  accessToken: string | null;
  user: ExtensionUser | null;
  status: "signedOut" | "connecting" | "connected" | "expired";
  recording: SessionCtx | null;
  /** Package output for upload; kept after `stop` until `submit` / `discard`. */
  lastRecorderOutput: import("@openmate/extension-recorder").RecorderOutput | null;
  startWallMs: number;
};

const state: AppState = {
  accessToken: null,
  user: null,
  status: "signedOut",
  recording: null,
  lastRecorderOutput: null,
  startWallMs: 0
};

let lastSubmitMetadata: SkillMetadataDraft | null = null;
let cachedBase: string | null = null;

async function ensureApiBase(): Promise<string> {
  if (cachedBase) {
    return cachedBase;
  }
  cachedBase = await resolveApiBaseUrl();
  return cachedBase;
}

function buildCtx(base: string): FetchJsonContext {
  return {
    baseUrl: base,
    getAccessToken: () => state.accessToken,
    onRefreshAccessToken: async () => {
      const rt = await readRefreshToken();
      if (!rt) {
        state.status = "expired";
        state.user = null;
        state.accessToken = null;
        return false;
      }
      const b = await ensureApiBase();
      const r = await authClient.refreshSession(
        { baseUrl: b, getAccessToken: () => state.accessToken, onRefreshAccessToken: async () => false },
        rt
      );
      if (!r.ok) {
        if (r.error.status === 401) {
          await clearSession();
          state.user = null;
          state.status = "expired";
        }
        state.accessToken = null;
        return false;
      }
      state.accessToken = r.data.accessToken;
      const st = await readStoredSession();
      if (st?.user) {
        await persistSession({ user: st.user, status: "connected", refreshToken: r.data.refreshToken });
        return true;
      }
      return false;
    }
  };
}

async function hydrateUserFromToken(base: string): Promise<void> {
  const u = await authClient.getCurrentUser(buildCtx(base));
  if (u.ok) {
    state.user = {
      id: u.data.id,
      email: u.data.email,
      displayName: u.data.displayName
    };
  }
}

void (async function restore() {
  const s = await readStoredSession();
  if (!s) {
    state.status = "signedOut";
    return;
  }
  state.user = s.user;
  state.status = s.status;
})().catch(() => {
  /* ignore */
});

function mapHandoffError(code: string, message: string) {
  if (code === "HANDOFF_INVALID")
    return err("HANDOFF_EXPIRED", message);
  if (code === "CLIENT_KIND_MISMATCH")
    return err("DASHBOARD_ORIGIN_NOT_ALLOWED", message);
  return err("HANDOFF_EXCHANGE_FAILED", message);
}

async function putBytes(url: string, body: ArrayBuffer, contentType: string): Promise<boolean> {
  const res = await fetch(url, { method: "PUT", body, headers: { "content-type": contentType } });
  return res.ok;
}

function extVersionLabel(): string {
  return chrome.runtime.getManifest()?.version ?? "0.1.0";
}

function newSessionCtx(
  data: StartSessionResponse,
  clientRecordingId: string,
  pageUrl: string,
  _pageTitle: string | undefined,
  activeTabId: number,
  voice: VoiceStatus,
  voicePref: "prompt" | "on" | "off"
): SessionCtx {
  return {
    clientRecordingId,
    backendSessionId: data.sessionId,
    skillId: data.skillId,
    recordingConfigurationVersion: data.recordingConfigurationVersion,
    status: "active",
    startedAt: new Date(state.startWallMs).toISOString(),
    activeTabId,
    voicePreference: voicePref,
    sessionUploadSlots: data.uploadSlots,
    voiceStatus: voice,
    voiceDurationMs: 0
  };
}

async function startSessionAfterStartOk(
  data: StartSessionResponse,
  activeTabId: number,
  pageUrl: string,
  pageTitle: string | undefined,
  voice: VoiceStatus,
  voicePref: "prompt" | "on" | "off"
): Promise<OpenMateResponse<unknown>> {
  const clientRecordingId = crypto.randomUUID();
  state.startWallMs = Date.now();
  state.lastRecorderOutput = null;
  clearActivityFeed();
  setRecordingStartWall(state.startWallMs);

  const recResult = startRecording({
    clientRecordingId,
    serverRecordingId: data.sessionId,
    recorderVersion: `${RECORDER_VERSION_PREFIX}${extVersionLabel()}`,
    startTimestampMs: state.startWallMs,
    environment: { extensionVersion: `v${extVersionLabel()}` },
    initialTab: {
      tabId: activeTabId,
      url: pageUrl,
      title: pageTitle,
      status: "active"
    }
  });
  if (!recResult.ok) {
    return err("RECORDING_START_FAILED", recResult.error.message);
  }

  state.recording = newSessionCtx(data, clientRecordingId, pageUrl, pageTitle, activeTabId, voice, voicePref);
  const post = await sendRecorderActivateToTab(activeTabId, {
    type: "openmate.recorder.activate",
    clientRecordingId,
    startWallMs: state.startWallMs,
    voicePreference: voicePref
  });
  if (!post.ok) {
    state.recording = null;
    clearActivityFeed();
    discardRecording();
    return err("RECORDER_INJECTION_FAILED", post.message);
  }
  pushActivitySummary("Recording started");
  return ok({
    clientRecordingId,
    status: "active",
    voiceStatus: voice
  });
}

export async function handleOpenMateMessage(
  request: OpenMateRequest,
  sender: chrome.runtime.MessageSender
): Promise<OpenMateResponse<unknown>> {
  const base = await ensureApiBase();
  const ctx = buildCtx(base);

  switch (request.type) {
    case "openmate.ping": {
      return ok({ status: "alive" });
    }
    case "openmate.auth.receiveHandoff": {
      if (!sender.tab?.id) {
        return err("DASHBOARD_ORIGIN_NOT_ALLOWED", "Dashboard handoff must come from a tab");
      }
      if (!sender.url) {
        return err("DASHBOARD_ORIGIN_NOT_ALLOWED", "Missing page URL for dashboard origin check");
      }
      const allow = await resolveDashboardOrigins();
      if (!isAllowedDashboardPageUrl(sender.url, allow)) {
        return err("DASHBOARD_ORIGIN_NOT_ALLOWED", "This page is not an allowed OpenMate dashboard origin");
      }
      if (!request.code || request.code.length < 8) {
        return err("HANDOFF_EXCHANGE_FAILED", "Handoff code missing or invalid");
      }
      state.status = "connecting";
      const ex = await authClient.exchangeHandoff(ctx, request.code);
      if (!ex.ok) {
        state.status = "expired";
        return mapHandoffError(ex.error.code, ex.error.message);
      }
      state.accessToken = ex.data.accessToken;
      const me = await authClient.getCurrentUser(ctx);
      if (!me.ok) {
        state.status = "expired";
        return err("HANDOFF_EXCHANGE_FAILED", "Could not read profile after handoff");
      }
      const user: ExtensionUser = {
        id: me.data.id,
        email: me.data.email,
        displayName: me.data.displayName
      };
      state.user = user;
      state.status = "connected";
      await persistSession({ user, status: "connected", refreshToken: ex.data.refreshToken });
      return ok({ status: "connected" });
    }
    case "openmate.auth.getStatus": {
      void takeStaleSessionError();
      const rec = state.recording;
      const snap = getRecorderSnapshot();
      const stepCount =
        rec?.status === "active"
          ? snap.eventCount
          : state.lastRecorderOutput?.evidencePackage.events.length ?? snap.eventCount;
      const recording = rec
        ? {
            status: rec.status,
            stepCount,
            clientRecordingId: rec.clientRecordingId,
            activeTabId: rec.activeTabId,
            pendingFormDefaults: rec.pendingFormDefaults,
            stopSummary: rec.stopSummary
          }
        : undefined;
      return ok({
        status: state.status,
        user: state.user ?? undefined,
        recording,
        activityLog: getActivityFeed()
      });
    }
    case "openmate.auth.refresh": {
      const r = await ctx.onRefreshAccessToken();
      if (!r) {
        return err("SESSION_EXPIRED", "Session expired. Reconnect from the dashboard.");
      }
      await hydrateUserFromToken(base);
      return ok({ status: "connected" });
    }
    case "openmate.auth.signOutLocal": {
      state.accessToken = null;
      state.user = null;
      state.status = "signedOut";
      clearActivityFeed();
      await clearSession();
      return ok({ status: "signedOut" });
    }
    case "openmate.recording.start": {
      if (state.status !== "connected" || !state.user) {
        return err("AUTH_REQUIRED", "Connect the extension from the OpenMate dashboard first");
      }
      if (state.recording && (state.recording.status === "active" || state.recording.status === "starting")) {
        return err("RECORDING_ALREADY_ACTIVE", "A recording is already in progress");
      }
      if (getRecorderStatus() === "active") {
        return err("RECORDING_ALREADY_ACTIVE", "A recording is already in progress");
      }
      const tab = await chrome.tabs.get(request.activeTabId).catch(() => null);
      if (!tab || !tab.url) {
        return err("RECORDER_INJECTION_FAILED", "Active tab is not available");
      }
      if (!isSupportedPageUrl(tab.url)) {
        return err("RESTRICTED_PAGE", "This page cannot be recorded");
      }
      const voice = initialVoiceState(request.voicePreference, null);
      const st = await recClient.startRecordingSession(ctx, {
        recorderVersion: `${RECORDER_VERSION_PREFIX}${extVersionLabel()}`,
        initialTitle: `${new URL(tab.url).hostname} flow - ${new Date().toLocaleString()}`
      });
      if (!st.ok) {
        if (st.error.status === 401) {
          const rr = await ctx.onRefreshAccessToken();
          if (rr) {
            const st2 = await recClient.startRecordingSession(ctx, {
              recorderVersion: `${RECORDER_VERSION_PREFIX}${extVersionLabel()}`,
              initialTitle: `${new URL(tab.url).hostname} flow - ${new Date().toLocaleString()}`
            });
            if (!st2.ok) {
              return err("AUTH_REQUIRED", st2.error.message);
            }
            return startSessionAfterStartOk(st2.data, request.activeTabId, tab.url!, tab.title, voice, request.voicePreference);
          }
        }
        return err("AUTH_REQUIRED", st.error.message);
      }
      return startSessionAfterStartOk(st.data, request.activeTabId, tab.url!, tab.title, voice, request.voicePreference);
    }
    case "openmate.recording.event": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No matching active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const raw = request.event;
      const tabId =
        sender.tab?.id && (raw.tabId === undefined || raw.tabId === 0) ? sender.tab.id : raw.tabId;
      if (!tabId) {
        return err("RECORDING_NOT_ACTIVE", "Missing tab for event");
      }
      const ev: OpenMateRecordingEvent = {
        ...raw,
        tabId,
        sensitivity: raw.sensitivity ?? { classification: "none", valueCaptured: "captured", reasons: [] }
      };
      captureDomEventFromExtension(ev, state.startWallMs, tabId);
      pushActivitySummary(formatOpenMateEventSummary(ev));
      broadcastPanelPoke();
      const s2 = getRecorderSnapshot();
      return ok({
        sequenceIndex: Math.max(0, s2.eventCount - 1),
        stepCount: s2.eventCount
      });
    }
    case "openmate.recording.attachNote": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const noteTab = request.tabId > 0 ? request.tabId : (sender.tab?.id ?? state.recording.activeTabId ?? 0);
      if (!noteTab) {
        return err("RECORDING_NOT_ACTIVE", "Missing tab for note");
      }
      const t = request.text?.trim() ?? "";
      if (!t) {
        return err("EMPTY_NOTE", "Note is empty");
      }
      attachUserNote(t, noteTab, request.timestampMs);
      pushActivitySummary("Note added");
      broadcastPanelPoke();
      return ok({ noteId: "package", nearestEventId: "" });
    }
    case "openmate.recording.takeScreenshot": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const capTab = request.tabId > 0 ? request.tabId : (sender.tab?.id ?? state.recording.activeTabId ?? 0);
      if (!capTab) {
        return err("SCREENSHOT_BLOCKED", "Missing tab for screenshot");
      }
      const tinfo = await chrome.tabs.get(capTab).catch(() => null);
      const blocked = assertScreenshotNotBlockedForUrl(tinfo?.url);
      if (!blocked.ok) {
        return err(blocked.code, "Screenshot is not available on this page");
      }
      if (tinfo?.windowId == null) {
        return err("SCREENSHOT_BLOCKED", "Could not determine a window to capture");
      }
      const cap = await chrome.tabs.captureVisibleTab(tinfo.windowId, { format: "png" });
      if (!cap) {
        return err("SCREENSHOT_BLOCKED", "Could not capture visible tab");
      }
      const blob = await dataUrlToBlob(cap);
      const ab = await blob.arrayBuffer();
      const bytes = new Uint8Array(ab);
      state.recording.lastScreenshotPng = ab;
      attachScreenshotBytes(bytes, blob.type || "image/png", capTab, request.timestampMs);
      pushActivitySummary("Screenshot captured");
      broadcastPanelPoke();
      return ok({ screenshotId: "package", sequenceNumber: getRecorderSnapshot().attachmentCount, nearestEventId: "" });
    }
    case "openmate.recording.stopForReview": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_FOUND", "No recording in progress");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const r = stopRecording();
      if (!r.ok) {
        return err("RECORDER_STOP_FAILED", r.error.message);
      }
      const out = r.data;
      state.lastRecorderOutput = out;
      const ep = out.evidencePackage;
      const typedNoteCount = ep.attachments.filter((a) => a.type === "note").length;
      const screenshotCount = ep.attachments.filter((a) => a.type === "screenshot").length;
      const cur = state.recording;
      const ct = ep.tabs[0]?.currentTitle;
      const titleText =
        ct && typeof ct === "object" && "text" in ct && typeof (ct as { text?: string }).text === "string"
          ? (ct as { text: string }).text.slice(0, 200)
          : "Recording";
      state.recording = {
        ...cur,
        status: "stoppedPendingForm",
        pendingFormDefaults: {
          title: titleText,
          allowedDomains: [],
          tags: []
        },
        stopSummary: {
          stepCount: ep.events.length,
          voiceDurationMs: cur.voiceDurationMs,
          typedNoteCount,
          screenshotCount
        }
      };
      pushActivitySummary("Recording stopped — fill in details to save");
      broadcastPanelPoke();
      return ok({
        status: "stoppedPendingForm",
        defaults: state.recording.pendingFormDefaults ?? { title: "", allowedDomains: [], tags: [] },
        summary: state.recording.stopSummary ?? {
          stepCount: 0,
          voiceDurationMs: 0,
          typedNoteCount: 0,
          screenshotCount: 0
        }
      });
    }
    case "openmate.recording.submit": {
      lastSubmitMetadata = request.metadata;
      return runUploadAndComplete(ctx, request.metadata, false);
    }
    case "openmate.recording.retryUpload": {
      if (state.recording && state.recording.status === "uploadFailed" && state.recording.clientRecordingId === request.clientRecordingId) {
        if (!lastSubmitMetadata) {
          return err("UPLOAD_FAILED", "Submit the form first to set metadata, then retry.");
        }
        return runUploadAndComplete(ctx, lastSubmitMetadata, true);
      }
      const p = await getPendingUpload(request.clientRecordingId);
      if (!p) {
        return err("RECORDING_NOT_FOUND", "No pending upload to retry");
      }
      return err("UPLOAD_FAILED", "Re-open the status page with an active session to complete recovery.");
    }
    case "openmate.recording.discard": {
      if (state.recording?.clientRecordingId && request.clientRecordingId && state.recording.clientRecordingId !== request.clientRecordingId) {
        if (request.confirmed) {
          await clearPendingUpload(request.clientRecordingId);
        }
        return err("CONFIRMATION_REQUIRED", "No matching active recording; confirm to clear any pending state");
      }
      if (state.recording) {
        if (!request.confirmed) {
          return err("CONFIRMATION_REQUIRED", "Set confirmed=true to discard this recording");
        }
        const rid = state.recording.clientRecordingId;
        state.recording = null;
        state.lastRecorderOutput = null;
        lastSubmitMetadata = null;
        discardRecording();
        clearActivityFeed();
        await clearPendingUpload(rid);
        broadcastPanelPoke();
        return ok({ status: "discarded" });
      }
      if (request.confirmed) {
        await clearPendingUpload(request.clientRecordingId);
        lastSubmitMetadata = null;
        clearActivityFeed();
        broadcastPanelPoke();
        return ok({ status: "discarded" });
      }
      return err("CONFIRMATION_REQUIRED", "Set confirmed to discard pending data");
    }
  }
  return err("UNHANDLED", "Unhandled OpenMate message");
}

async function runUploadAndComplete(
  ctx: FetchJsonContext,
  metadata: SkillMetadataDraft,
  isRetry: boolean
): Promise<OpenMateResponse<unknown>> {
  if (!state.recording || !state.lastRecorderOutput) {
    return err("RECORDING_NOT_FOUND", "Nothing to upload");
  }
  if (!["stoppedPendingForm", "uploadFailed"].includes(state.recording.status)) {
    return err("UPLOAD_FAILED", "Stop the recording and complete the form first");
  }
  if (!metadata.title?.trim()) {
    return err("TITLE_REQUIRED", "A title is required to save the recording");
  }
  if (!state.recording.backendSessionId) {
    return err("UPLOAD_FAILED", "Missing backend session; restart the recording and try again");
  }
  const backendSessionId = state.recording.backendSessionId;
  const out = state.lastRecorderOutput;
  const m2cPayload: Record<string, unknown> = {
    schema: "openmate.recorder.v1",
    clientRecordingId: out.evidencePackage.clientRecordingId,
    evidenceSchemaVersion: out.evidencePackage.schemaVersion,
    eventCount: out.evidencePackage.events.length,
    extensionVersion: `v${extVersionLabel()}`,
    metadata: {
      title: metadata.title.trim(),
      humanDescription: metadata.humanDescription ?? null,
      allowedDomains: metadata.allowedDomains,
      tags: metadata.tags
    }
  };
  if (!isRetry) {
    state.recording = { ...state.recording, status: "uploading" };
    broadcastPanelPoke();
  }

  let uploadSlots: UploadSlot[] = state.recording.sessionUploadSlots;
  if (isRetry) {
    const re = await recClient.reissueUploads(ctx, backendSessionId, {});
    if (!re.ok) {
      if (state.recording.backendSessionId) {
        state.recording = { ...state.recording, status: "uploadFailed" };
        await savePendingUpload({
          clientRecordingId: state.recording.clientRecordingId,
          backendSessionId,
          skillId: state.recording.skillId ?? "",
          recordingConfigurationVersion: state.recording.recordingConfigurationVersion ?? "",
          storagePrefix: "",
          uploadSlots: state.recording.sessionUploadSlots,
          lastErrorCode: re.error.code,
          updatedAt: new Date().toISOString()
        });
      }
      broadcastPanelPoke();
      return err("UPLOAD_FAILED", re.error.message);
    }
    uploadSlots = mergeReissuedSlots(state.recording.sessionUploadSlots, re.data.uploadSlots);
    state.recording = { ...state.recording, sessionUploadSlots: uploadSlots };
  }

  const eventsText = out.files[0]?.body ?? JSON.stringify(out.evidencePackage, null, 2);
  const eventsHash = await sha256HexOfBytes(new TextEncoder().encode(eventsText));
  const eventsSlot = findSlot(uploadSlots, "events") ?? uploadSlots.find(s => s.objectKey.endsWith("events.json"));
  if (!eventsSlot) {
    state.recording = { ...state.recording, status: "uploadFailed" };
    broadcastPanelPoke();
    return err("UPLOAD_FAILED", "Backend did not return an events upload target");
  }
  const okE = await putBytes(eventsSlot.uploadUrl, new TextEncoder().encode(eventsText).buffer, "application/json");
  if (!okE) {
    const re = await recClient.reissueUploads(ctx, backendSessionId, { slots: ["events"] });
    if (re.ok) {
      state.recording = { ...state.recording, sessionUploadSlots: mergeReissuedSlots(uploadSlots, re.data.uploadSlots) };
      const uploadSlots2 = state.recording.sessionUploadSlots;
      const slot2 = findSlot(uploadSlots2, "events");
      if (slot2) {
        const r2 = await putBytes(slot2.uploadUrl, new TextEncoder().encode(eventsText).buffer, "application/json");
        if (!r2) {
          state.recording = { ...state.recording, status: "uploadFailed" };
          broadcastPanelPoke();
          return err("UPLOAD_FAILED", "Could not upload events artifact after reissue");
        }
      } else {
        state.recording = { ...state.recording, status: "uploadFailed" };
        broadcastPanelPoke();
        return err("UPLOAD_FAILED", "Reissue did not return events target");
      }
    } else {
      state.recording = { ...state.recording, status: "uploadFailed" };
      broadcastPanelPoke();
      return err("UPLOAD_FAILED", "Could not upload events");
    }
  }

  const png = state.recording.lastScreenshotPng ?? minPngBuffer();
  const screenSlot = findSlot(uploadSlots, "screenshot1") ?? uploadSlots.find(s => s.objectKey.includes("screenshot"));
  if (!screenSlot) {
    state.recording = { ...state.recording, status: "uploadFailed" };
    broadcastPanelPoke();
    return err("UPLOAD_FAILED", "Backend did not return a screenshot upload target");
  }
  const imgHash = await sha256HexOfBytes(png);
  const okP = await putBytes(screenSlot.uploadUrl, png, "image/png");
  if (!okP) {
    const re = await recClient.reissueUploads(ctx, backendSessionId, { slots: ["screenshot1", "events"] });
    if (re.ok) {
      state.recording = { ...state.recording, sessionUploadSlots: mergeReissuedSlots(state.recording.sessionUploadSlots, re.data.uploadSlots) };
      const us = state.recording.sessionUploadSlots;
      const s2 = findSlot(us, "screenshot1");
      if (s2) {
        const p2 = await putBytes(s2.uploadUrl, png, "image/png");
        if (!p2) {
          state.recording = { ...state.recording, status: "uploadFailed" };
          broadcastPanelPoke();
          return err("UPLOAD_FAILED", "Screenshot upload failed");
        }
      } else {
        broadcastPanelPoke();
        return err("UPLOAD_FAILED", "Reissue did not return screenshot target");
      }
    } else {
      state.recording = { ...state.recording, status: "uploadFailed" };
      broadcastPanelPoke();
      return err("UPLOAD_FAILED", "Screenshot upload failed");
    }
  }

  const manifest: Record<string, unknown> = {
    clientRecordingId: state.recording.clientRecordingId,
    recordingConfigurationVersion: state.recording.recordingConfigurationVersion ?? "",
    m2cPayload,
    recordingArtifacts: { evidencePackageSchema: out.evidencePackage.schemaVersion },
    artifacts: {
      events: { objectKey: "events.json", sha256: eventsHash },
      screenshot1: { objectKey: "screenshots/1.png", sha256: imgHash }
    }
  };
  const comp = await recClient.completeRecordingSession(ctx, backendSessionId, {
    title: metadata.title.trim(),
    humanDescription: metadata.humanDescription ?? null,
    allowedDomains: metadata.allowedDomains,
    tags: metadata.tags,
    manifest
  });

  if (!comp.ok) {
    if (state.recording.backendSessionId) {
      state.recording = { ...state.recording, status: "uploadFailed" };
      await savePendingUpload({
        clientRecordingId: state.recording.clientRecordingId,
        backendSessionId,
        skillId: state.recording.skillId ?? "",
        recordingConfigurationVersion: state.recording.recordingConfigurationVersion ?? "",
        storagePrefix: "",
        uploadSlots: state.recording.sessionUploadSlots,
        lastErrorCode: comp.error.code,
        updatedAt: new Date().toISOString()
      });
    }
    broadcastPanelPoke();
    return err("UPLOAD_FAILED", comp.error.message);
  }
  const skill = comp.data.skillId;
  const rid = state.recording.clientRecordingId;
  const dashboardUrl = `https://openmate.ai/s/${encodeURIComponent(skill)}`;
  state.recording = null;
  state.lastRecorderOutput = null;
  lastSubmitMetadata = null;
  clearActivityFeed();
  await clearPendingUpload(rid);
  broadcastPanelPoke();
  return ok({ status: "uploaded", skillId: comp.data.skillId, dashboardUrl });
}

