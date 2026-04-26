import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import hudSurfaceCss from "./hud.css?raw";

const STYLE_ID = "om-hud-injected-style";
const HOST_ID = "om-hud-host";

let root: Root | null = null;

function injectHudStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = hudSurfaceCss;
  (document.head || document.documentElement).appendChild(el);
}

type HudProps = { recordingId: string };

const Hud: React.FC<HudProps> = ({ recordingId }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div
      className={`om-hud-surface ${collapsed ? "is-collapsed" : ""}`}
      data-openmate-ignore-capture
      data-openmate-hud
    >
      <div className="om-hud__head">
        <span className="om-hud__title">Recording</span>
        <div className="om-hud__head-actions">
          <button
            type="button"
            className="om-hud__icon om-hud__icon--danger"
            onClick={() => {
              void chrome.runtime.sendMessage({
                type: "openmate.recording.stopForReview",
                clientRecordingId: recordingId,
              });
            }}
          >
            Stop
          </button>
          <button
            type="button"
            className="om-hud__icon"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? "Open" : "Minimize"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="om-hud__body">
          <label className="om-hud__field">
            <span>Note</span>
            <textarea
              className="om-hud__textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              onBlur={() => {
                if (!note.trim()) {
                  return;
                }
                void chrome.runtime.sendMessage({
                  type: "openmate.recording.attachNote",
                  clientRecordingId: recordingId,
                  text: note,
                  tabId: 0,
                  timestampMs: Date.now(),
                });
              }}
            />
          </label>
          <button
            type="button"
            className="om-hud__action"
            onClick={() => {
              void chrome.runtime.sendMessage({
                type: "openmate.recording.takeScreenshot",
                clientRecordingId: recordingId,
                tabId: 0,
                timestampMs: Date.now(),
              });
            }}
          >
            Screenshot
          </button>
        </div>
      )}
    </div>
  );
};

function getOrCreateHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    return existing;
  }
  const host = document.createElement("div");
  host.id = HOST_ID;
  (document.body ?? document.documentElement).appendChild(host);
  return host;
}

function showHudOverlay(recordingId: string) {
  injectHudStyles();
  const host = getOrCreateHost();
  if (!root) {
    root = createRoot(host);
  }
  root.render(
    <React.StrictMode>
      <Hud key={recordingId} recordingId={recordingId} />
    </React.StrictMode>,
  );
}

const g = globalThis as unknown as { __omHudMessageBound?: true };
if (!g.__omHudMessageBound) {
  g.__omHudMessageBound = true;
  chrome.runtime.onMessage.addListener((
    msg: { type?: string; clientRecordingId?: string },
  ) => {
    if (msg?.type === "openmate.hud.show" && msg.clientRecordingId) {
      showHudOverlay(msg.clientRecordingId);
    }
    return false;
  });
}
