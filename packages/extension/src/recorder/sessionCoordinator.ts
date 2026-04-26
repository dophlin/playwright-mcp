import { describePageSupport, isSupportedPageUrl } from "./pageSupport";
import type { OpenMateRecordingEvent, RecordedTabState, VoiceStatus } from "./types";
import { randomId } from "./ids";

export type ActiveRecordingView = {
  clientRecordingId: string;
  startedAtMs: number;
  activeTabId: number | null;
  knownTabs: Map<number, RecordedTabState>;
  voiceStatus: VoiceStatus;
};

/**
 * Coordinates per-tab state for the active OpenMate recording. MCP relay traffic is untouched.
 */
export class RecordingSessionCoordinator {
  private _view: ActiveRecordingView | null = null;

  get active(): ActiveRecordingView | null {
    return this._view;
  }

  start(clientRecordingId: string, activeTabId: number, voice: VoiceStatus, startUrl: string): void {
    const now = Date.now();
    this._view = {
      clientRecordingId,
      startedAtMs: now,
      activeTabId,
      knownTabs: new Map(),
      voiceStatus: voice,
    };
    void this.recordTab(activeTabId, startUrl);
  }

  setActiveTab(tabId: number): void {
    if (!this._view)
      return;
    this._view.activeTabId = tabId;
  }

  setVoiceStatus(v: VoiceStatus): void {
    if (this._view)
      this._view.voiceStatus = v;
  }

  recordTab(tabId: number, url: string | undefined): RecordedTabState {
    if (!this._view)
      throw new Error("no_active_recording");
    const now = new Date().toISOString();
    const support = describePageSupport(url);
    const existing = this._view.knownTabs.get(tabId);
    if (existing) {
      const next: RecordedTabState = {
        ...existing,
        lastSeenAt: now,
        currentUrl: url,
        status: support,
      };
      this._view.knownTabs.set(tabId, next);
      return next;
    }
    const s: RecordedTabState = {
      tabId,
      firstSeenAt: now,
      lastSeenAt: now,
      currentUrl: url,
      status: support,
    };
    this._view.knownTabs.set(tabId, s);
    return s;
  }

  stop(): void {
    this._view = null;
  }

  appendTabLifecycleEvent(
    kind: "tab_open" | "tab_switch" | "tab_close",
    tabId: number,
    relMs: number,
  ): OpenMateRecordingEvent {
    if (!this._view)
      throw new Error("no_active_recording");
    const url = this._view.knownTabs.get(tabId)?.currentUrl;
    return {
      eventId: randomId(),
      sequenceIndex: undefined,
      timestampMs: relMs,
      tabId,
      actionType: kind,
      url,
      sensitivity: { classification: "none", valueCaptured: "captured", reasons: [] },
    };
  }

  isSupported(url: string | undefined): boolean {
    return isSupportedPageUrl(url);
  }
}
