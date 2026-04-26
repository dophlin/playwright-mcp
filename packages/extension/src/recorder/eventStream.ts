import type { OpenMateRecordingEvent, RecordedTabState } from "./types";

export function sortEventsChronologically(events: OpenMateRecordingEvent[]): OpenMateRecordingEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestampMs !== b.timestampMs)
      return a.timestampMs - b.timestampMs;
    return a.eventId.localeCompare(b.eventId);
  });
}

/**
 * Reassign strictly increasing sequenceIndex values in chronological order.
 */
export function assignSequenceIndices(events: OpenMateRecordingEvent[]): OpenMateRecordingEvent[] {
  const ordered = sortEventsChronologically(events);
  return ordered.map((e, i) => ({ ...e, sequenceIndex: i }));
}

export function mergeTabCloseOpen(
  events: OpenMateRecordingEvent[],
  tabMeta: Map<number, RecordedTabState>,
): OpenMateRecordingEvent[] {
  // Reserved for future cross-tab merge rules; currently chronological sort is enough.
  void tabMeta;
  return assignSequenceIndices(events);
}
