import { pushActivitySummary } from "./activityFeed";
import { afterRecorderMutation, getOpenMateRecorder } from "./recorderHost";

let installed = false;

function activeRecorderOrNull() {
  const r = getOpenMateRecorder();
  return r.status === "active" ? r : null;
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
    rec.capture({
      eventType: "tab_switch",
      tabId: activeInfo.tabId,
      timestampMs: Date.now()
    });
    afterRecorderMutation();
    pushActivitySummary("Switched tab");
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
