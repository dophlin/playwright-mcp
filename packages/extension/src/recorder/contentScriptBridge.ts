/**
 * When a tab was open before the extension reloaded, manifest content scripts
 * are not in the page yet — `tabs.sendMessage` fails. Inject the bundles once,
 * then resend. Idempotent: content entry points guard against double listeners.
 */
const RECORDING_BUNDLE = "lib/content/recorderContent.mjs" as const;

export type ActivateRecorderMessage = {
  type: "openmate.recorder.activate";
  clientRecordingId: string;
  startWallMs: number;
  voicePreference: "prompt" | "on" | "off";
};

export type RecordingContentPostResult = { ok: true } | { ok: false; message: string };

async function sendWithOptionalInject(
  tabId: number,
  message: object,
  injected: { v: boolean },
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    if (!injected.v) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          files: [RECORDING_BUNDLE],
        });
        injected.v = true;
      } catch {
        throw new Error("inject");
      }
    }
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      throw new Error("resend");
    }
  }
}

export async function sendRecorderActivateToTab(
  tabId: number,
  activate: ActivateRecorderMessage,
): Promise<RecordingContentPostResult> {
  const injected = { v: false };
  try {
    await sendWithOptionalInject(tabId, activate, injected);
  } catch (e) {
    const m = e instanceof Error && e.message === "inject"
      ? "Could not load recording scripts on this page. Use an https:// page, refresh it, and try again."
      : "The recording panel could not reach this tab. Refresh the page, then start recording again.";
    return { ok: false, message: m };
  }
  return { ok: true };
}
