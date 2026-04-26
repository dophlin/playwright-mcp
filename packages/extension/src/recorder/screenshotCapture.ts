import { isRestrictedPageUrl } from "./pageSupport";
import { randomId } from "./ids";

/**
 * `chrome.tabCapture` is not in our manifest; we capture via extension page path only
 * for restricted pages, callers should block up-front.
 */
export function assertScreenshotNotBlockedForUrl(url: string | undefined | null):
  { ok: true } | { ok: false; code: "RESTRICTED_PAGE" | "SCREENSHOT_BLOCKED" } {
  if (isRestrictedPageUrl(url)) {
    return { ok: false, code: "RESTRICTED_PAGE" };
  }
  return { ok: true };
}

export function newScreenshotId(): string {
  return randomId();
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
