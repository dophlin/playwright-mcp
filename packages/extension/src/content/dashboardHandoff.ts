type HandoffMessage = { type: "openmate-dashboard-handoff"; code: string };

/**
 * Receives a handoff `code` from the OpenMate dashboard (window.postMessage) and
 * exchanges it in the service worker. The dashboard should post a message in the
 * form `{ type: 'openmate-dashboard-handoff', code }` from a trusted same-origin page.
 */
window.addEventListener("message", (event: MessageEvent) => {
  if (event.origin && event.origin !== window.location.origin) {
    return;
  }
  const d = event.data as Partial<HandoffMessage> | undefined;
  if (!d || d.type !== "openmate-dashboard-handoff" || typeof d.code !== "string" || d.code.length < 4) {
    return;
  }
  void chrome.runtime
      .sendMessage({ type: "openmate.auth.receiveHandoff", code: d.code, source: "dashboard-postmessage" });
});
