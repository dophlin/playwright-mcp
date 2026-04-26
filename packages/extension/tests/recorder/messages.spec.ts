import { test, expect } from "@playwright/test";
import { err, isOpenMateRequest, ok } from "../../src/recorder/messages";

test("OpenMate response envelopes", () => {
  expect(ok({ a: 1 }).ok).toBe(true);
  const e = err("CODE", "msg");
  expect(e.ok).toBe(false);
  if (!e.ok) {
    expect(e.error.code).toBe("CODE");
  }
});

test("isOpenMateRequest guards extension messages", () => {
  expect(isOpenMateRequest({ type: "openmate.ping" })).toBe(true);
  expect(isOpenMateRequest({ type: "openmate.auth.getStatus" })).toBe(true);
  expect(isOpenMateRequest({ type: "connectToMCPRelay" } as { type: string })).toBe(false);
  expect(isOpenMateRequest(null)).toBe(false);
});
