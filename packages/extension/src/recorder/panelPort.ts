import type { ActivityRow } from "./activityFormat";

export const PANEL_PORT_NAME = "openmate.panel";

const ports = new Set<chrome.runtime.Port>();

export function registerPanelPortListeners(): void {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== PANEL_PORT_NAME)
      return;
    ports.add(port);
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  });
}

export type PanelToExtensionMessage = Record<string, never>;

export type ExtensionToPanelMessage =
  | { type: "openmate.panel.activity"; row: ActivityRow }
  | { type: "openmate.panel.poke" };

function postToAll(message: ExtensionToPanelMessage): void {
  for (const p of ports) {
    try {
      p.postMessage(message);
    } catch {
      ports.delete(p);
    }
  }
}

export function broadcastActivityRow(row: ActivityRow): void {
  postToAll({ type: "openmate.panel.activity", row });
}

export function broadcastPanelPoke(): void {
  postToAll({ type: "openmate.panel.poke" });
}
