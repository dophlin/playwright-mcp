import { getDashboardOriginsFromEnv, getDefaultApiBaseUrl } from "./env";

const API_BASE_KEY = "openmate_api_base_v1";
const DASHBOARDS_KEY = "openmate_dashboard_origins_v1";

export async function resolveApiBaseUrl(): Promise<string> {
  const { [API_BASE_KEY]: v } = await chrome.storage.local.get(API_BASE_KEY) as { [k: string]: string | undefined };
  if (typeof v === "string" && v.trim().length)
    return v.replace(/\/$/, "");
  return getDefaultApiBaseUrl();
}

export async function resolveDashboardOrigins(): Promise<string[]> {
  const { [DASHBOARDS_KEY]: raw } = await chrome.storage.local.get(DASHBOARDS_KEY) as { [k: string]: string | undefined };
  if (typeof raw === "string" && raw.trim())
    return raw.split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  return getDashboardOriginsFromEnv();
}
