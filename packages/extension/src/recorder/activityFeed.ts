import { randomId } from "./ids";
import { broadcastActivityRow, type ActivityRow } from "./panelPort";
import type { OpenMateRecordingEvent } from "./types";

const MAX_ROWS = 400;
const rows: ActivityRow[] = [];
let startWallMs = 0;

export function setRecordingStartWall(wallMs: number): void {
  startWallMs = wallMs;
}

export function clearActivityFeed(): void {
  rows.length = 0;
}

function offsetMs(): number {
  return Date.now() - startWallMs;
}

/**
 * Append a live activity line for the side panel (in-memory, same source as `getStatus` / `openmate.auth.getStatus`).
 */
export function pushActivitySummary(summary: string): void {
  const t = summary.trim() || "Step";
  const text = t.length > 220 ? `${t.slice(0, 217)}…` : t;
  const row: ActivityRow = {
    id: randomId(),
    offsetMs: offsetMs(),
    summary: text
  };
  rows.push(row);
  if (rows.length > MAX_ROWS) {
    rows.splice(0, rows.length - MAX_ROWS);
  }
  broadcastActivityRow(row);
}

export function getActivityFeed(): ActivityRow[] {
  return rows;
}

export function formatOpenMateEventSummary(ev: OpenMateRecordingEvent): string {
  const a = ev.actionType;
  if (a === "click") {
    return `Click${ev.elementLabel ? ` — ${ev.elementLabel}` : ""}${ev.elementRole ? ` (${ev.elementRole})` : ""}`;
  }
  if (a === "input" || a === "select") {
    return `Input${ev.elementLabel ? ` — ${ev.elementLabel}` : ""}`;
  }
  if (a === "tab_switch") {
    return "Switched tab";
  }
  if (a === "tab_open") {
    return "New tab";
  }
  if (a === "tab_close") {
    return "Tab closed";
  }
  if (a === "scroll") {
    return "Scroll";
  }
  if (a === "keypress") {
    return `Key${ev.keyPressed ? ` — ${ev.keyPressed}` : ""}`;
  }
  if (a === "restricted_page") {
    return "Restricted page";
  }
  if (a === "navigate") {
    return "Navigation";
  }
  if (a === "hover") {
    return "Hover";
  }
  if (a === "screenshot") {
    return "Screenshot (event)";
  }
  return a;
}
