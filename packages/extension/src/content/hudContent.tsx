import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./hud.css";

let root: ReturnType<typeof createRoot> | null = null;
let clientRecordingId: string | null = null;

const Hud: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = setInterval(() => {
      if (!clientRecordingId) {
        return;
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  if (!clientRecordingId) {
    return null;
  }
  return (
    <div
      className={`om-hud-surface ${collapsed ? "is-collapsed" : ""}`}
      data-openmate-ignore-capture
      data-openmate-hud
    >
      <div className="om-hud__head">
        <span className="om-hud__title">Recording</span>
        <button
          type="button"
          className="om-hud__icon"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? "Open" : "Minimize"}
        </button>
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
                  clientRecordingId: clientRecordingId!,
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
                clientRecordingId: clientRecordingId!,
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

function ensureMounted() {
  if (root) {
    return;
  }
  const host = document.createElement("div");
  host.id = "om-hud-host";
  document.documentElement.appendChild(host);
  root = createRoot(host);
  root.render(
    <React.StrictMode>
      <Hud />
    </React.StrictMode>,
  );
}

chrome.runtime.onMessage.addListener((
  msg: { type?: string; clientRecordingId?: string },
) => {
  if (msg?.type === "openmate.hud.show" && msg.clientRecordingId) {
    clientRecordingId = msg.clientRecordingId;
    ensureMounted();
  }
  return false;
});
