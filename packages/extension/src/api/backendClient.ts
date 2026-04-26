import { API_PREFIX } from "../recorder/env";

export type BackendError = {
  status: number;
  code: string;
  message: string;
};

export type BackendResult<T> = { ok: true; data: T } | { ok: false; error: BackendError };

export type FetchJsonContext = {
  baseUrl: string;
  getAccessToken: () => string | null;
  onRefreshAccessToken: () => Promise<boolean>;
};

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function fetchJsonWithRefresh<T>(
  ctx: FetchJsonContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<BackendResult<T>> {
  const url = joinUrl(ctx.baseUrl, path);
  const attempt = async (useRefresh: boolean): Promise<BackendResult<T>> => {
    const token = ctx.getAccessToken();
    const headers: Record<string, string> = {};
    if (body !== undefined)
      headers["content-type"] = "application/json";
    if (token)
      headers["authorization"] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error";
      return { ok: false, error: { status: 0, code: "NETWORK_ERROR", message } };
    }

    const text = await res.text();
    const json = text ? tryParseJson(text) : null;

    if (res.status === 401 && useRefresh) {
      const refreshed = await ctx.onRefreshAccessToken();
      if (refreshed)
        return attempt(false);
    }

    if (!res.ok) {
      const code = (json as { error?: { code?: string; message?: string } } | null)?.error?.code ?? "HTTP_ERROR";
      const message = (json as { error?: { code?: string; message?: string } } | null)?.error?.message
        ?? res.statusText;
      return { ok: false, error: { status: res.status, code, message } };
    }

    if (json === null) {
      return { ok: false, error: { status: res.status, code: "EMPTY_RESPONSE", message: "No JSON body" } };
    }
    return { ok: true, data: json as T };
  };

  return attempt(true);
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function v1Path(rel: string): string {
  const s = rel.startsWith("/") ? rel : `/${rel}`;
  if (s === API_PREFIX || s.startsWith(`${API_PREFIX}/`))
    return s;
  return `${API_PREFIX}${s}`;
}
