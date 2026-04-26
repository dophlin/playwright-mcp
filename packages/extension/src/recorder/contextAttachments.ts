import { randomId } from "./ids";
import type { OpenMateRecordingEvent } from "./types";

export function nearestEventId(
  events: OpenMateRecordingEvent[],
  tabId: number,
  timestampMs: number,
): string | null {
  const tabEvents = events
      .filter(e => e.tabId === tabId)
      .map(e => ({ e, d: Math.abs(e.timestampMs - timestampMs) }));
  if (tabEvents.length === 0) {
    const all = events.map(e => ({ e, d: Math.abs(e.timestampMs - timestampMs) }));
    if (all.length === 0)
      return null;
    all.sort((a, b) => a.d - b.d);
    return all[0]!.e.eventId;
  }
  tabEvents.sort((a, b) => a.d - b.d);
  return tabEvents[0]!.e.eventId;
}

export function createNoteId(): string {
  return randomId();
}
