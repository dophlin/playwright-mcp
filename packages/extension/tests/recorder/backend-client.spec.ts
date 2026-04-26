import { test, expect } from "@playwright/test";

/**
 * Mirrors `v1Path` in `src/api/backendClient.ts` (keeps this spec free of `import.meta` loading issues in the Playwright runner).
 */
function v1Path(rel: string): string {
  const API_PREFIX = "/v1";
  const s = rel.startsWith("/") ? rel : `/${rel}`;
  if (s === API_PREFIX || s.startsWith(`${API_PREFIX}/`)) {
    return s;
  }
  return `${API_PREFIX}${s}`;
}

test("v1Path prefixes /v1", () => {
  expect(v1Path("/auth/me")).toBe("/v1/auth/me");
  expect(v1Path("auth/refresh")).toBe("/v1/auth/refresh");
  expect(v1Path("/v1/health")).toBe("/v1/health");
});
