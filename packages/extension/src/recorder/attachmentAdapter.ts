import { afterRecorderMutation, getOpenMateRecorder } from "./recorderHost";
import { countUtf8Bytes } from "./recorderConstants";

function uint8ToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function attachUserNote(text: string, tabId?: number, timestampMs?: number): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  r.attachNote({ note: text, tabId, timestampMs });
  afterRecorderMutation();
}

export function attachVoiceTranscriptAsNote(transcript: string, tabId?: number, timestampMs?: number): void {
  attachUserNote(transcript, tabId, timestampMs);
}

/**
 * @param bytes raw pixels from `chrome.tabs.captureVisibleTab` (decodes to image)
 */
export function attachScreenshotBytes(bytes: Uint8Array, mimeType: string, tabId?: number, timestampMs?: number): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  const uri = uint8ToDataUrl(bytes, mimeType || "image/png");
  r.attachScreenshot({
    uri,
    fileName: "visible-tab.png",
    byteSize: bytes.byteLength,
    tabId,
    timestampMs
  });
  afterRecorderMutation();
}

export { countUtf8Bytes as screenshotByteSize };
