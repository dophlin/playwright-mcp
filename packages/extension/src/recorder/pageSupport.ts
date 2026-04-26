const RESTRICTED_PREFIXES = [
  "chrome://",
  "edge://",
  "about:",
  "devtools://",
  "chrome-extension://",
  "view-source:",
  "moz-extension://",
];

const RESTRICTED_HOSTS = new Set([
  "chrome.google.com", // store — treat as non-workflow
]);

/**
 * Heuristic: pages where workflow recording is supported and scripting is allowed.
 */
export function isSupportedPageUrl(href: string | undefined | null): boolean {
  if (!href)
    return false;
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return false;
    if (RESTRICTED_PREFIXES.some(p => href.startsWith(p)))
      return false;
    if (RESTRICTED_HOSTS.has(u.hostname))
      return false;
    return true;
  } catch {
    return false;
  }
}

export function isRestrictedPageUrl(href: string | undefined | null): boolean {
  return !isSupportedPageUrl(href);
}

export function describePageSupport(href: string | undefined | null): "supported" | "restricted" {
  return isSupportedPageUrl(href) ? "supported" : "restricted";
}
