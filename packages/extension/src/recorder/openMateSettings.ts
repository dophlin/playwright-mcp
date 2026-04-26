import { getDashboardOriginsFromEnv, getDefaultApiBaseUrl } from "./env";

const API_BASE_KEY = "openmate_api_base_v1";
const DASHBOARDS_KEY = "openmate_dashboard_origins_v1";

/**
 * `fetch` only works with http(s). A mistaken `ws://` URL (e.g. pasted MCP relay URL) must be rejected.
 */
export function normalizeHttpApiBase(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || !raw.trim())
    return null;
  const t = raw.trim().replace(/\/$/, "");
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return null;
    return t;
  } catch {
    return null;
  }
}

export async function resolveApiBaseUrl(): Promise<string> {
  const { [API_BASE_KEY]: v } = await chrome.storage.local.get(API_BASE_KEY) as { [k: string]: string | undefined };
  const n = normalizeHttpApiBase(v);
  if (n) {
    return n;
  }
  if (typeof v === "string" && v.trim().length) {
    await chrome.storage.local.remove(API_BASE_KEY);
  }
  return getDefaultApiBaseUrl();
}

export async function resolveDashboardOrigins(): Promise<string[]> {
  const { [DASHBOARDS_KEY]: raw } = await chrome.storage.local.get(DASHBOARDS_KEY) as { [k: string]: string | undefined };
  if (typeof raw === "string" && raw.trim())
    return raw.split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  return getDashboardOriginsFromEnv();
}
