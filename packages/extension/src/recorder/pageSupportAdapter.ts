import { afterRecorderMutation, getOpenMateRecorder } from "./recorderHost";

const RESTRICTED_PREFIXES = [
  "chrome://",
  "edge://",
  "about:",
  "devtools://",
  "chrome-extension://",
  "view-source:",
  "moz-extension://"
];

const RESTRICTED_HOSTS = new Set(["chrome.google.com"]);

/**
 * Heuristic: pages where workflow recording is supported and scripting is allowed.
 * (Formerly `pageSupport.ts` — kept here so `pageSupport.ts` can be removed in US3.)
 */
export function isSupportedPageUrl(href: string | undefined | null): boolean {
  if (!href) {
    return false;
  }
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return false;
    }
    if (RESTRICTED_PREFIXES.some(p => href.startsWith(p))) {
      return false;
    }
    if (RESTRICTED_HOSTS.has(u.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markUnsupportedRestrictedPage(tabId?: number, url?: string): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  r.markUnsupportedContext({
    reason: "restricted_page",
    tabId,
    description: url ? `Unsupported URL: ${url.slice(0, 200)}` : undefined
  });
  afterRecorderMutation();
}

export function markBlockedFrame(tabId?: number, description?: string): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  r.markUnsupportedContext({ reason: "inaccessible_frame", tabId, description });
  afterRecorderMutation();
}

export function markMissingOptionalCapability(tabId?: number, description?: string): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  r.markUnsupportedContext({ reason: "missing_optional_capability", tabId, description });
  afterRecorderMutation();
}
