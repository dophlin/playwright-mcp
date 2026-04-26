import { test, expect } from "@playwright/test";
import { mergeReissuedSlots } from "../../src/storage/pendingUploadStore";
import type { UploadSlot } from "../../src/recorder/types";

test("mergeReissuedSlots overwrites by slot id", () => {
  const before: UploadSlot[] = [
    { slot: "events", objectKey: "k1", uploadUrl: "https://a.example/a", required: true },
  ];
  const after: UploadSlot[] = [
    { slot: "events", objectKey: "k1", uploadUrl: "https://b.example/b", required: true },
  ];
  const merged = mergeReissuedSlots(before, after);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.uploadUrl).toContain("b.example");
});
