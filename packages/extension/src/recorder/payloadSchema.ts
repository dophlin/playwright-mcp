import type { FinalPayload } from "./payloadBuilder";

/**
 * Fast structural validation for the finalized payload before network upload.
 */
export function assertValidM2cPayload(p: FinalPayload): void {
  if (p.schemaVersion !== "m2-c-v1")
    throw new Error("INVALID_SCHEMA_VERSION");
  if (!p.clientRecordingId)
    throw new Error("MISSING_CLIENT_RECORDING_ID");
  if (!p.startedAt || !p.endedAt)
    throw new Error("MISSING_TIME_BOUNDS");
  if (!p.extensionVersion)
    throw new Error("MISSING_EXTENSION_VERSION");
  if (!Array.isArray(p.events) || p.events.length < 1)
    throw new Error("EVENTS_REQUIRED");
  if (!p.guardrailSummary)
    throw new Error("GUARDRAIL_SUMMARY_REQUIRED");
}
