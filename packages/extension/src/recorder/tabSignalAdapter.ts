import { sendRecorderActivateToTab } from "./contentScriptBridge";
import { getRecorderActivationContext } from "./recorderActivationContext";
import { pushActivitySummary } from "./activityFeed";
import { afterRecorderMutation, getOpenMateRecorder } from "./recorderHost";
import { isSupportedPageUrl } from "./pageSupportAdapter";
import { notifyRecordingActiveTabChanged } from "./recorderTabSync";

let installed = false;

function activeRecorderOrNull() {
  const r = getOpenMateRecorder();
  return r.status === "active" ? r : null;
}

/**
 * Injects or refreshes the recorder content script for this tab so DOM events are captured
 * (e.g. after opening a link in a new tab and switching to it, or when a slow page loads after focus).
 */
async function attemptActivateRecorderOnTab(tabId: number): Promise<void> {
  const ctx = getRecorderActivationContext();
  if (!ctx) {
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !isSupportedPageUrl(tab.url)) {
    return;
  }
  await sendRecorderActivateToTab(tabId, {
    type: "openmate.recorder.activate",
    clientRecordingId: ctx.clientRecordingId,
    startWallMs: ctx.startWallMs,
    voicePreference: ctx.voicePreference
  });
}

export function registerTabSignalAdapter(): void {
  if (installed) {
    return;
  }
  installed = true;

  chrome.tabs.onCreated.addListener(tab => {
    const rec = activeRecorderOrNull();
    if (!rec || tab.id == null) {
      return;
    }
    rec.recordTab({
      tabId: tab.id,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url: tab.url,
      title: tab.title,
      status: "open",
      timestampMs: Date.now()
    });
    rec.capture({
      eventType: "tab_open",
      tabId: tab.id,
      url: tab.url,
      pageTitle: tab.title,
      timestampMs: Date.now()
    });
    afterRecorderMutation();
    pushActivitySummary("New tab");
  });

  chrome.tabs.onActivated.addListener(activeInfo => {
    const rec = activeRecorderOrNull();
    if (!rec) {
      return;
    }
    notifyRecordingActiveTabChanged(activeInfo.tabId);
    rec.capture({
      eventType: "tab_switch",
      tabId: activeInfo.tabId,
      timestampMs: Date.now()
    });
    afterRecorderMutation();
    pushActivitySummary("Switched tab");
    void attemptActivateRecorderOnTab(activeInfo.tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      void (async () => {
        if (!activeRecorderOrNull()) {
          return;
        }
        const t = await chrome.tabs.get(tabId).catch(() => null);
        if (!t?.active || !t.url || !isSupportedPageUrl(t.url)) {
          return;
        }
        await attemptActivateRecorderOnTab(tabId);
      })();
    }

    if (changeInfo.status === "loading" && !changeInfo.url) {
      return;
    }
    if (changeInfo.url === undefined && changeInfo.title === undefined) {
      return;
    }
    const rec = activeRecorderOrNull();
    if (!rec) {
      return;
    }
    rec.recordTab({
      tabId,
      url: tab.url,
      title: tab.title,
      status: "open",
      timestampMs: Date.now()
    });
    afterRecorderMutation();
    pushActivitySummary(changeInfo.url !== undefined ? "Page navigated" : "Page title updated");
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    const rec = activeRecorderOrNull();
    if (!rec) {
      return;
    }
    rec.capture({
      eventType: "tab_close",
      tabId,
      timestampMs: Date.now()
    });
    afterRecorderMutation();
    pushActivitySummary("Tab closed");
  });
}
