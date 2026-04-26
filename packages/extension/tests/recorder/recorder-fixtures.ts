import type { OpenMateResponse } from "../../src/recorder/messages";

/**
 * Helpers for recorder-related Playwright tests: assert OpenMate wire envelopes.
 */
export function assertOpenMateOk<T>(r: OpenMateResponse<T> | undefined, label = "openmate") {
  if (!r) {
    throw new Error(`${label}: no response`);
  }
  if (!r.ok) {
    throw new Error(`${label}: ${r.error.code} — ${r.error.message}`);
  }
  return r.data;
}

export function isOpenMateErrorCode(r: OpenMateResponse<unknown> | undefined, code: string) {
  return r && !r.ok && r.error.code === code;
}
