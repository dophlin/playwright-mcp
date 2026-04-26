import type { OpenMateRecordingEvent, OpenMateRecordingSessionState, TypedNoteRecord, ScreenshotRecord } from "./types";

/** Sanitized row for the side panel activity log (no raw sensitive values). */
export type ActivityRow = {
  id: string;
  offsetMs: number;
  summary: string;
};

function hostFromUrl(url: string | undefined): string {
  if (!url)
    return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function sensitivityHint(ev: OpenMateRecordingEvent): string {
  const c = ev.sensitivity?.classification ?? "none";
  if (c === "none" || c === "redacted")
    return "";
  if (c === "suspectedPii")
    return " (sensitive)";
  if (c === "credential" || c === "payment")
    return " (redacted)";
  return "";
}

export function formatRecordingEvent(ev: OpenMateRecordingEvent): ActivityRow {
  const host = hostFromUrl(ev.url);
  const label = ev.elementLabel ? `"${ev.elementLabel.slice(0, 80)}${ev.elementLabel.length > 80 ? "…" : ""}"` : ev.elementRole || "";
  let summary = `${ev.actionType}`;
  if (label)
    summary += ` · ${label}`;
  if (host)
    summary += ` · ${host}`;
  if (ev.actionType === "input") {
    const cap = ev.sensitivity?.valueCaptured;
    if (cap === "redacted" || cap === "omitted")
      summary += " · value redacted";
    else
      summary += sensitivityHint(ev);
  }
  return {
    id: ev.eventId,
    offsetMs: ev.timestampMs,
    summary,
  };
}

export function formatNoteActivity(note: TypedNoteRecord, startWallMs: number): ActivityRow {
  const off = note.timestampMs - startWallMs;
  const preview = note.text.length > 60 ? `${note.text.slice(0, 60)}…` : note.text;
  return {
    id: `note:${note.noteId}`,
    offsetMs: off,
    summary: `note · ${preview.replace(/\s+/g, " ").trim()}`,
  };
}

export function formatScreenshotActivity(s: ScreenshotRecord, startWallMs: number): ActivityRow {
  return {
    id: `shot:${s.screenshotId}`,
    offsetMs: s.timestampMs - startWallMs,
    summary: "screenshot captured",
  };
}

const DEFAULT_LIMIT = 400;

/**
 * Merge recording events, typed notes, and screenshots into one chronological list for UI hydrate.
 */
export function mergeActivityLog(
  rec: OpenMateRecordingSessionState,
  startWallMs: number,
  limit = DEFAULT_LIMIT,
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const e of rec.events)
    rows.push(formatRecordingEvent(e));
  for (const n of rec.typedNotes)
    rows.push(formatNoteActivity(n, startWallMs));
  for (const s of rec.screenshots)
    rows.push(formatScreenshotActivity(s, startWallMs));
  rows.sort((a, b) => {
    if (a.offsetMs !== b.offsetMs)
      return a.offsetMs - b.offsetMs;
    return a.id.localeCompare(b.id);
  });
  if (rows.length <= limit)
    return rows;
  return rows.slice(-limit);
}
