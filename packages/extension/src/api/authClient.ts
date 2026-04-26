import type { BackendResult } from "./backendClient";
import { fetchJsonWithRefresh, v1Path } from "./backendClient";
import type { FetchJsonContext } from "./backendClient";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
};

export type MeResponse = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: string | null;
};

export function exchangeHandoff(
  ctx: FetchJsonContext,
  code: string,
): Promise<BackendResult<TokenPair>> {
  return fetchJsonWithRefresh<TokenPair>(ctx, "POST", v1Path("/auth/google/exchange"), {
    code,
    clientKind: "browser_extension",
  });
}

export function refreshSession(
  ctx: FetchJsonContext,
  refreshToken: string,
): Promise<BackendResult<TokenPair>> {
  return fetchJsonWithRefresh<TokenPair>(ctx, "POST", v1Path("/auth/refresh"), {
    refreshToken,
    clientKind: "browser_extension",
  });
}

export function getCurrentUser(
  ctx: FetchJsonContext,
): Promise<BackendResult<MeResponse>> {
  return fetchJsonWithRefresh<MeResponse>(ctx, "GET", v1Path("/auth/me"));
}
