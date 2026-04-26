import * as authClient from "../api/authClient";
import type { FetchJsonContext } from "../api/backendClient";
import * as recClient from "../api/recordingClient";
import type { StartSessionResponse } from "../api/recordingClient";
import { clearPendingUpload, getPendingUpload, mergeReissuedSlots, savePendingUpload } from "../storage/pendingUploadStore";
import { clearSession, persistSession, readRefreshToken, readStoredSession } from "../storage/extensionSessionStore";
import { nearestEventId, createNoteId } from "./contextAttachments";
import { applyStopForReview } from "./finalizeRecording";
import { normalizeRawRecorderEvent, type RawRecorderEvent } from "./eventNormalizer";
import { assertValidM2cPayload } from "./payloadSchema";
import { buildM2CPayload, buildEventsUploadBody } from "./payloadBuilder";
import { sha256HexOfJson, sha256HexOfBytes, findSlot } from "./uploadManifest";
import { isAllowedDashboardPageUrl, getDefaultApiBaseUrl } from "./env";
import { sendRecorderAndHudToTab } from "./contentScriptBridge";
import { resolveApiBaseUrl, resolveDashboardOrigins } from "./openMateSettings";
import { err, ok, type OpenMateRequest, type OpenMateResponse } from "./messages";
import { isSupportedPageUrl } from "./pageSupport";
import { newScreenshotId, assertScreenshotNotBlockedForUrl, dataUrlToBlob } from "./screenshotCapture";
import { initialVoiceState } from "./voiceCapture";
import { RecordingSessionCoordinator } from "./sessionCoordinator";
import { updateGuardSummary } from "./guardrails";
import type { ExtensionUser, OpenMateRecordingEvent, OpenMateRecordingSessionState, SkillMetadataDraft, TypedNoteRecord, UploadSlot, VoiceStatus } from "./types";
import { randomId } from "./ids";

const RECORDER_VERSION_PREFIX = "extension-";
const MIN_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9Yk0AAAAASUVORK5CYII=";

function minPngBuffer(): ArrayBuffer {
  const bin = atob(MIN_PNG_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++)
    u[i] = bin.charCodeAt(i);
  return u.buffer;
}

type AppState = {
  accessToken: string | null;
  user: ExtensionUser | null;
  status: "signedOut" | "connecting" | "connected" | "expired";
  recording: OpenMateRecordingSessionState | null;
  startWallMs: number;
  coord: RecordingSessionCoordinator;
  tabHooks: boolean;
};

const state: AppState = {
  accessToken: null,
  user: null,
  status: "signedOut",
  recording: null,
  startWallMs: 0,
  coord: new RecordingSessionCoordinator(),
  tabHooks: false,
};

/** Last form values for upload retry after a failure. */
let lastSubmitMetadata: SkillMetadataDraft | null = null;

let cachedBase: string | null = null;

async function ensureApiBase(): Promise<string> {
  if (cachedBase)
    return cachedBase;
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
      const r = await authClient.refreshSession({ baseUrl: b, getAccessToken: () => state.accessToken, onRefreshAccessToken: async () => false }, rt);
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
    },
  };
}

async function hydrateUserFromToken(base: string): Promise<void> {
  const u = await authClient.getCurrentUser(buildCtx(base));
  if (u.ok) {
    state.user = {
      id: u.data.id,
      email: u.data.email,
      displayName: u.data.displayName,
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
  // Do not call the network on service worker start: avoids ERR_CONNECTION / backend-down noise in
  // chrome://extensions, and the access token is memory-only. First protected call or
  // openmate.auth.refresh will run refresh; getStatus is safe offline for UI.
})().catch(() => {
  /* ignore */
});

function ensureOpenMateTabHooks() {
  if (state.tabHooks)
    return;
  state.tabHooks = true;
  chrome.tabs.onActivated.addListener(async activeInfo => {
    if (!state.recording || state.recording.status !== "active")
      return;
    const { tabId } = activeInfo;
    state.recording.activeTabId = tabId;
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      state.coord.recordTab(tabId, tab.url);
      try {
        const d = new URL(tab.url);
        if (!state.recording.visitedDomains.includes(d.hostname))
          state.recording.visitedDomains.push(d.hostname);
      } catch { /* */ }
    }
    const rel = Date.now() - state.startWallMs;
    if (isSupportedPageUrl(tab.url)) {
      const e = state.coord.appendTabLifecycleEvent("tab_switch", tabId, rel);
      state.recording.events.push(e);
      state.recording.stepCount = state.recording.events.length;
    } else {
      const rpe: OpenMateRecordingEvent = {
        eventId: randomId(),
        timestampMs: rel,
        tabId,
        actionType: "restricted_page",
        url: tab.url,
        sensitivity: { classification: "none", valueCaptured: "captured", reasons: ["restricted"] },
      };
      state.recording.events.push(rpe);
      state.recording.stepCount = state.recording.events.length;
    }
    void chrome.tabs
        .sendMessage(tabId, {
      type: "openmate.recorder.refresh",
      clientRecordingId: state.recording.clientRecordingId,
      startWallMs: state.startWallMs,
    })
        .catch(() => {});
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    if (!state.recording || state.recording.status !== "active")
      return;
    const rel = Date.now() - state.startWallMs;
    const e = state.coord.appendTabLifecycleEvent("tab_close", tabId, rel);
    state.recording.events.push(e);
    state.recording.stepCount = state.recording.events.length;
  });
}

async function putBytes(url: string, body: ArrayBuffer, contentType: string): Promise<boolean> {
  const res = await fetch(url, { method: "PUT", body, headers: { "content-type": contentType } });
  return res.ok;
}

function mapHandoffError(code: string, message: string) {
  if (code === "HANDOFF_INVALID")
    return err("HANDOFF_EXPIRED", message);
  if (code === "CLIENT_KIND_MISMATCH")
    return err("DASHBOARD_ORIGIN_NOT_ALLOWED", message);
  return err("HANDOFF_EXCHANGE_FAILED", message);
}

function newRecordingState(
  data: StartSessionResponse,
  clientRecordingId: string,
  url: string,
  title: string | undefined,
  activeTabId: number,
  voice: VoiceStatus,
  uploadSlots: UploadSlot[],
): OpenMateRecordingSessionState {
  return {
    clientRecordingId,
    backendSessionId: data.sessionId,
    skillId: data.skillId,
    recordingConfigurationVersion: data.recordingConfigurationVersion,
    status: "active",
    startedAt: new Date(state.startWallMs).toISOString(),
    startingUrl: url,
    startingTabTitle: title,
    activeTabId,
    visitedDomains: (() => {
      try {
        return [new URL(url).hostname];
      } catch {
        return [];
      }
    })(),
    stepCount: 0,
    voiceStatus: voice,
    events: [],
    tabMeta: new Map(),
    sessionUploadSlots: uploadSlots,
    voiceDurationMs: 0,
    typedNoteCount: 0,
    screenshotCount: 0,
    guardrailSummary: { redactedInputCount: 0, suspectedPiiCount: 0, credentialFieldCount: 0, paymentFieldCount: 0 },
    typedNotes: [],
    screenshots: [],
  };
}

async function startSessionAfterStartOk(
  data: StartSessionResponse,
  activeTabId: number,
  pageUrl: string,
  pageTitle: string | undefined,
  voice: VoiceStatus,
  voicePref: "prompt" | "on" | "off",
): Promise<OpenMateResponse<unknown>> {
  const clientRecordingId = crypto.randomUUID();
  state.coord = new RecordingSessionCoordinator();
  state.startWallMs = Date.now();
  state.coord.start(clientRecordingId, activeTabId, voice, pageUrl);
  state.recording = newRecordingState(data, clientRecordingId, pageUrl, pageTitle, activeTabId, voice, data.uploadSlots);
  ensureOpenMateTabHooks();
  const evSlot = findSlot(data.uploadSlots, "events");
  if (evSlot) {
    state.recording.eventsJsonUploadSlot = { objectKey: evSlot.objectKey, uploadUrl: evSlot.uploadUrl };
  }
  const post = await sendRecorderAndHudToTab(
      activeTabId,
      {
        type: "openmate.recorder.activate",
        clientRecordingId,
        startWallMs: state.startWallMs,
        voicePreference: voicePref,
      },
      { type: "openmate.hud.show", clientRecordingId },
  );
  if (!post.ok) {
    state.recording = null;
    state.coord.stop();
    return err("RECORDER_INJECTION_FAILED", post.message);
  }
  return ok({
    clientRecordingId,
    status: "active",
    voiceStatus: voice,
  });
}

export async function handleOpenMateMessage(
  request: OpenMateRequest,
  sender: chrome.runtime.MessageSender,
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
        displayName: me.data.displayName,
      };
      state.user = user;
      state.status = "connected";
      await persistSession({ user, status: "connected", refreshToken: ex.data.refreshToken });
      return ok({ status: "connected" });
    }
    case "openmate.auth.getStatus": {
      const rec = state.recording;
      const recording =
        rec && (rec.status === "active" || rec.status === "starting")
          ? { status: rec.status, stepCount: rec.stepCount }
          : undefined;
      return ok({
        status: state.status,
        user: state.user ?? undefined,
        recording,
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
        initialTitle: `${new URL(tab.url).hostname} flow - ${new Date().toLocaleString()}`,
      });
      if (!st.ok) {
        if (st.error.status === 401) {
          const rr = await ctx.onRefreshAccessToken();
          if (rr) {
            const st2 = await recClient.startRecordingSession(ctx, {
              recorderVersion: `${RECORDER_VERSION_PREFIX}${extVersionLabel()}`,
              initialTitle: `${new URL(tab.url).hostname} flow - ${new Date().toLocaleString()}`,
            });
            if (!st2.ok) {
              return err("AUTH_REQUIRED", st2.error.message);
            }
            return startSessionAfterStartOk(
              st2.data,
              request.activeTabId,
              tab.url!,
              tab.title,
              voice,
              request.voicePreference,
            );
          }
        }
        return err("AUTH_REQUIRED", st.error.message);
      }
      return startSessionAfterStartOk(
        st.data,
        request.activeTabId,
        tab.url!,
        tab.title,
        voice,
        request.voicePreference,
      );
    }
    case "openmate.recording.event": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No matching active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const raw = (request.event as unknown) as OpenMateRecordingEvent & Partial<RawRecorderEvent>;
      if (sender.tab?.id && (raw.tabId === undefined || raw.tabId === 0)) {
        raw.tabId = sender.tab.id;
      }
      let ev: OpenMateRecordingEvent;
      if (raw.sensitivity && raw.eventId) {
        ev = request.event;
        updateGuardSummary(state.recording.guardrailSummary, ev.sensitivity);
      } else {
        const rawEv: RawRecorderEvent = {
          actionType: raw.actionType!,
          tabId: raw.tabId,
          timestampMs: raw.timestampMs,
          url: raw.url,
          pageTitle: raw.pageTitle,
          selectorCandidates: raw.selectorCandidates,
          elementRole: raw.elementRole,
          elementLabel: raw.elementLabel,
          boundingRect: raw.boundingRect,
          value: raw.value,
          keyPressed: raw.keyPressed,
          inputContext: (raw as { inputContext?: import("./guardrails").InputContext }).inputContext,
        };
        ev = normalizeRawRecorderEvent(rawEv);
        updateGuardSummary(state.recording.guardrailSummary, ev.sensitivity);
      }
      const tOff = ev.timestampMs;
      const e2: OpenMateRecordingEvent = { ...ev, timestampMs: tOff };
      state.recording.events.push(e2);
      state.recording.stepCount = state.recording.events.length;
      if (e2.url) {
        try {
          const h = new URL(e2.url).hostname;
          if (!state.recording.visitedDomains.includes(h)) {
            state.recording.visitedDomains.push(h);
          }
        } catch { /* */ }
      }
      return ok({
        sequenceIndex: state.recording.events.length - 1,
        stepCount: state.recording.events.length,
      });
    }
    case "openmate.recording.attachNote": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const noteTab = request.tabId > 0 ? request.tabId : (sender.tab?.id ?? 0);
      if (!noteTab) {
        return err("RECORDING_NOT_ACTIVE", "Missing tab for note");
      }
      const t = request.text?.trim() ?? "";
      if (!t) {
        return err("EMPTY_NOTE", "Note is empty");
      }
      const nid = createNoteId();
      const nearest = nearestEventId(state.recording.events, noteTab, request.timestampMs);
      const note: TypedNoteRecord = { noteId: nid, text: t, tabId: noteTab, timestampMs: request.timestampMs, nearestEventId: nearest };
      state.recording.typedNotes.push(note);
      state.recording.typedNoteCount = state.recording.typedNotes.length;
      return ok({ noteId: nid, nearestEventId: nearest ?? "" });
    }
    case "openmate.recording.takeScreenshot": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_ACTIVE", "No active recording");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const capTab = request.tabId > 0 ? request.tabId : (sender.tab?.id ?? 0);
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
      const sid = newScreenshotId();
      state.recording.screenshots.push({ screenshotId: sid, tabId: capTab, timestampMs: request.timestampMs, png: ab });
      state.recording.screenshotCount = state.recording.screenshots.length;
      return ok({
        screenshotId: sid,
        sequenceNumber: state.recording.screenshots.length,
        nearestEventId: nearestEventId(state.recording.events, capTab, request.timestampMs) ?? "",
      });
    }
    case "openmate.recording.stopForReview": {
      if (!state.recording || state.recording.clientRecordingId !== request.clientRecordingId) {
        return err("RECORDING_NOT_FOUND", "No recording in progress");
      }
      if (state.recording.status !== "active") {
        return err("RECORDING_NOT_ACTIVE", "Recording is not active");
      }
      const now = new Date().toISOString();
      state.recording = applyStopForReview(state.recording, state.recording.voiceStatus, now);
      state.coord.stop();
      return ok({
        status: "stoppedPendingForm",
        defaults: state.recording.pendingFormDefaults,
        summary: {
          stepCount: state.recording.stopSummary?.stepCount ?? state.recording.stepCount,
          voiceDurationMs: state.recording.voiceDurationMs,
          typedNoteCount: state.recording.typedNoteCount,
          screenshotCount: state.recording.screenshotCount,
        },
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
      const id = state.recording?.clientRecordingId ?? null;
      if (request.clientRecordingId && state.recording?.clientRecordingId !== request.clientRecordingId) {
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
        state.coord.stop();
        lastSubmitMetadata = null;
        await clearPendingUpload(rid);
        return ok({ status: "discarded" });
      }
      if (request.confirmed) {
        await clearPendingUpload(request.clientRecordingId);
        lastSubmitMetadata = null;
        return ok({ status: "discarded" });
      }
      return err("CONFIRMATION_REQUIRED", "Set confirmed to discard pending data");
    }
  }
  return err("UNHANDLED", "Unhandled OpenMate message");
}

function extVersionLabel(): string {
  return chrome.runtime.getManifest()?.version ?? "0.1.0";
}

async function runUploadAndComplete(
  ctx: FetchJsonContext,
  metadata: SkillMetadataDraft,
  isRetry: boolean,
): Promise<OpenMateResponse<unknown>> {
  if (!state.recording) {
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

  const final = buildM2CPayload(
    state.recording,
    { ...metadata, title: metadata.title.trim(), humanDescription: metadata.humanDescription ?? null },
    `v${extVersionLabel()}`,
  );
  try {
    assertValidM2cPayload(final);
  } catch (e) {
    return err("BACKEND_VALIDATION_FAILED", e instanceof Error ? e.message : "Invalid payload");
  }

  if (!isRetry) {
    state.recording.status = "uploading";
  }

  let uploadSlots: UploadSlot[] = state.recording.sessionUploadSlots;
  if (isRetry) {
    const re = await recClient.reissueUploads(ctx, state.recording.backendSessionId, {});
    if (!re.ok) {
      state.recording.status = "uploadFailed";
      if (state.recording.backendSessionId) {
        await savePendingUpload({
          clientRecordingId: state.recording.clientRecordingId,
          backendSessionId: state.recording.backendSessionId,
          skillId: state.recording.skillId!,
          recordingConfigurationVersion: state.recording.recordingConfigurationVersion!,
          storagePrefix: "",
          uploadSlots: state.recording.sessionUploadSlots,
          lastErrorCode: re.error.code,
          updatedAt: new Date().toISOString(),
        });
      }
      return err("UPLOAD_FAILED", re.error.message);
    }
    uploadSlots = mergeReissuedSlots(state.recording.sessionUploadSlots, re.data.uploadSlots);
    state.recording.sessionUploadSlots = uploadSlots;
  }

  const eventsJson = buildEventsUploadBody(state.recording.events);
  const eventsText = JSON.stringify(eventsJson);
  const eventsHash = await sha256HexOfJson(eventsJson);
  const eventsSlot = findSlot(uploadSlots, "events") ?? uploadSlots.find(s => s.objectKey.endsWith("events.json"));
  if (!eventsSlot) {
    state.recording.status = "uploadFailed";
    return err("UPLOAD_FAILED", "Backend did not return an events upload target");
  }
  const okE = await putBytes(eventsSlot.uploadUrl, new TextEncoder().encode(eventsText).buffer, "application/json");
  if (!okE) {
    const re = await recClient.reissueUploads(ctx, state.recording.backendSessionId, { slots: ["events"] });
    if (re.ok) {
      state.recording.sessionUploadSlots = mergeReissuedSlots(uploadSlots, re.data.uploadSlots);
      uploadSlots = state.recording.sessionUploadSlots;
      const slot2 = findSlot(uploadSlots, "events");
      if (slot2) {
        const r2 = await putBytes(slot2.uploadUrl, new TextEncoder().encode(eventsText).buffer, "application/json");
        if (!r2) {
          state.recording.status = "uploadFailed";
          return err("UPLOAD_FAILED", "Could not upload events artifact after reissue");
        }
      } else {
        state.recording.status = "uploadFailed";
        return err("UPLOAD_FAILED", "Reissue did not return events target");
      }
    } else {
      state.recording.status = "uploadFailed";
      return err("UPLOAD_FAILED", "Could not upload events");
    }
  }

  const png = state.recording.screenshots[0]?.png ?? minPngBuffer();
  const screenSlot = findSlot(uploadSlots, "screenshot1") ?? uploadSlots.find(s => s.objectKey.includes("screenshot"));
  if (!screenSlot) {
    state.recording.status = "uploadFailed";
    return err("UPLOAD_FAILED", "Backend did not return a screenshot upload target");
  }
  const imgHash = await sha256HexOfBytes(png);
  const okP = await putBytes(screenSlot.uploadUrl, png, "image/png");
  if (!okP) {
    const re = await recClient.reissueUploads(ctx, state.recording.backendSessionId, { slots: ["screenshot1", "events"] });
    if (re.ok) {
      state.recording.sessionUploadSlots = mergeReissuedSlots(state.recording.sessionUploadSlots, re.data.uploadSlots);
      const us = state.recording.sessionUploadSlots;
      const s2 = findSlot(us, "screenshot1");
      if (s2) {
        const p2 = await putBytes(s2.uploadUrl, png, "image/png");
        if (!p2) {
          state.recording.status = "uploadFailed";
          return err("UPLOAD_FAILED", "Screenshot upload failed");
        }
      } else {
        return err("UPLOAD_FAILED", "Reissue did not return screenshot target");
      }
    } else {
      state.recording.status = "uploadFailed";
      return err("UPLOAD_FAILED", "Screenshot upload failed");
    }
  }

  const manifest: Record<string, unknown> = {
    clientRecordingId: state.recording.clientRecordingId,
    recordingConfigurationVersion: state.recording.recordingConfigurationVersion,
    m2cPayload: final,
    artifacts: {
      events: { objectKey: "events.json", sha256: eventsHash },
      screenshot1: { objectKey: "screenshots/1.png", sha256: imgHash },
    },
  };

  const comp = await recClient.completeRecordingSession(
    ctx,
    state.recording.backendSessionId,
    {
      title: metadata.title.trim(),
      humanDescription: metadata.humanDescription ?? null,
      allowedDomains: metadata.allowedDomains,
      tags: metadata.tags,
      manifest,
    },
  );

  if (!comp.ok) {
    state.recording.status = "uploadFailed";
    if (state.recording.backendSessionId) {
      await savePendingUpload({
        clientRecordingId: state.recording.clientRecordingId,
        backendSessionId: state.recording.backendSessionId,
        skillId: state.recording.skillId!,
        recordingConfigurationVersion: state.recording.recordingConfigurationVersion!,
        storagePrefix: "",
        uploadSlots: state.recording.sessionUploadSlots,
        lastErrorCode: comp.error.code,
        updatedAt: new Date().toISOString(),
      });
    }
    return err("UPLOAD_FAILED", comp.error.message);
  }

  const skill = comp.data.skillId;
  const dashboardUrl = `https://openmate.ai/s/${encodeURIComponent(skill)}`;
  const rid = state.recording.clientRecordingId;
  state.recording = null;
  lastSubmitMetadata = null;
  state.coord.stop();
  await clearPendingUpload(rid);

  return ok({ status: "uploaded", skillId: comp.data.skillId, dashboardUrl });
}
