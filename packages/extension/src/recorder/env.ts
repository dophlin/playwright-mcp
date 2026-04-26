/**
 * Build-time and runtime OpenMate service configuration for the extension.
 */
/** Default when no `VITE_OPENMATE_API_BASE` is set at build time and no storage override. */
const DEFAULT_API = "https://be-16-58-144-221.nip.io";

function readMetaEnvString(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[key];
}

export function getDefaultApiBaseUrl(): string {
  return readMetaEnvString("VITE_OPENMATE_API_BASE")?.replace(/\/$/, "") || DEFAULT_API;
}

export const API_PREFIX = "/v1";

const DEFAULT_DASHBOARDS = [
  "https://dash-16-58-144-221.nip.io",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseOriginList(s: string | undefined): string[] {
  if (!s?.trim())
    return DEFAULT_DASHBOARDS;
  return s
      .split(",")
      .map(p => p.trim().replace(/\/$/, ""))
      .filter(Boolean);
}

export function getDashboardOriginsFromEnv(): string[] {
  return parseOriginList(readMetaEnvString("VITE_OPENMATE_DASHBOARD_ORIGINS"));
}

export function isAllowedDashboardPageUrl(url: string, allowedOrigins: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:" && u.protocol !== "chrome-extension:")
      return false;
    const origin = `${u.protocol}//${u.host}`.toLowerCase();
    return allowedOrigins.some(a => a.toLowerCase() === origin);
  } catch {
    return false;
  }
}
