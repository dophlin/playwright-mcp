import { assignSequenceIndices } from "./eventStream";
import type { GuardrailSummary, OpenMateRecordingEvent, OpenMateRecordingSessionState, TypedNoteRecord } from "./types";

const SCHEMA = "m2-c-v1" as const;

export type FinalPayload = {
  schemaVersion: typeof SCHEMA;
  clientRecordingId: string;
  backendSessionId?: string;
  skillId?: string;
  startedAt: string;
  endedAt: string;
  extensionVersion: string;
  startingUrl?: string;
  startingTabTitle?: string;
  visitedDomains: string[];
  events: OpenMateRecordingEvent[];
  typedNotes: TypedNoteRecord[];
  voice: { status: string; durationMs: number } | null;
  screenshots: { id: string; tabId: number; timestampMs: number }[];
  metadata: { title: string; allowedDomains: string[]; tags: string[]; humanDescription: string | null };
  guardrailSummary: GuardrailSummary;
};

export function buildM2CPayload(
  session: OpenMateRecordingSessionState,
  metadata: { title: string; allowedDomains: string[]; tags: string[]; humanDescription: string | null },
  extensionVersion: string,
): FinalPayload {
  const events = assignSequenceIndices(session.events);
  return {
    schemaVersion: SCHEMA,
    clientRecordingId: session.clientRecordingId,
    backendSessionId: session.backendSessionId,
    skillId: session.skillId,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? new Date().toISOString(),
    extensionVersion,
    startingUrl: session.startingUrl,
    startingTabTitle: session.startingTabTitle,
    visitedDomains: [...new Set(session.visitedDomains)],
    events,
    typedNotes: session.typedNotes,
    voice: { status: session.voiceStatus, durationMs: session.voiceDurationMs },
    screenshots: session.screenshots.map(s => ({ id: s.screenshotId, tabId: s.tabId, timestampMs: s.timestampMs })),
    metadata: {
      title: metadata.title,
      allowedDomains: metadata.allowedDomains,
      tags: metadata.tags,
      humanDescription: metadata.humanDescription,
    },
    guardrailSummary: session.guardrailSummary,
  };
}

export function buildEventsUploadBody(events: OpenMateRecordingEvent[]): { events: OpenMateRecordingEvent[] } {
  return { events: assignSequenceIndices(events) };
}
