import type { OpenMateRecordingSessionState, SkillMetadataDraft, VoiceStatus } from "./types";

export function applyStopForReview(
  session: OpenMateRecordingSessionState,
  _voice: VoiceStatus,
  nowIso: string,
): OpenMateRecordingSessionState {
  return {
    ...session,
    status: "stoppedPendingForm",
    endedAt: nowIso,
    stopSummary: {
      stepCount: session.stepCount,
      voiceDurationMs: session.voiceDurationMs,
      typedNoteCount: session.typedNotes.length,
      screenshotCount: session.screenshots.length,
    },
    pendingFormDefaults: {
      title: session.startingUrl ? new URL(session.startingUrl).hostname : "OpenMate recording",
      allowedDomains: domainFromUrl(session.startingUrl),
      tags: [],
    },
  };
}

function domainFromUrl(url: string | undefined): string[] {
  if (!url)
    return [];
  try {
    return [new URL(url).hostname];
  } catch {
    return [];
  }
}

export function defaultMetadataForSession(session: OpenMateRecordingSessionState): SkillMetadataDraft {
  const d = applyStopForReview(session, session.voiceStatus, session.endedAt ?? new Date().toISOString());
  return {
    title: d.pendingFormDefaults?.title ?? "OpenMate recording",
    allowedDomains: d.pendingFormDefaults?.allowedDomains ?? [],
    tags: d.pendingFormDefaults?.tags ?? [],
    humanDescription: null,
  };
}
