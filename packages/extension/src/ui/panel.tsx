/**
 * OpenMate side panel: auth, recording controls, submit/discard, live activity log.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const PANEL_PORT_NAME = "openmate.panel";

const logoSrc = chrome.runtime.getURL("icons/icon-128.png");
const manifestVersion = chrome.runtime.getManifest()?.version;
const versionLabel = manifestVersion && typeof manifestVersion === "string" ? `v${manifestVersion}` : "v?";

type ActivityRow = { id: string; offsetMs: number; summary: string };

type RecordingPayload = {
  status: string;
  stepCount: number;
  clientRecordingId: string;
  activeTabId?: number;
  pendingFormDefaults?: { title: string; allowedDomains: string[]; tags: string[] };
  stopSummary?: {
    stepCount: number;
    voiceDurationMs: number;
    typedNoteCount: number;
    screenshotCount: number;
  };
};

type AuthStatusPayload = {
  status: string;
  user?: { id: string; email: string; displayName: string | null };
  recording?: RecordingPayload;
  activityLog?: ActivityRow[];
};

function defaultDashboardFromEnv(): string {
  const raw = import.meta.env.VITE_OPENMATE_DASHBOARD;
  if (typeof raw === "string" && raw.trim().length)
    return raw.replace(/\/$/, "");
  return "https://dash-16-58-144-221.nip.io";
}
const DEFAULT_DASHBOARD = defaultDashboardFromEnv();

async function readDashboardUrl(): Promise<string> {
  const { openmate_dashboard_url: u } = await chrome.storage.local.get("openmate_dashboard_url") as { openmate_dashboard_url?: string };
  if (typeof u === "string" && u.trim().length)
    return u.replace(/\/$/, "");
  return DEFAULT_DASHBOARD;
}

function formatOffset(ms: number): string {
  const s = ms / 1000;
  const sign = s < 0 ? "−" : "";
  return `${sign}${Math.abs(s).toFixed(1)}s`;
}

const PanelApp: React.FC = () => {
  const [auth, setAuth] = useState<AuthStatusPayload | null>(null);
  const [dashboard, setDashboard] = useState(DEFAULT_DASHBOARD);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [uploadDoneUrl, setUploadDoneUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [humanDescription, setHumanDescription] = useState("");
  const [domainsStr, setDomainsStr] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const activityRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);

  const refresh = useCallback(async () => {
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.auth.getStatus" });
    if (r && "ok" in r && r.ok) {
      const data = r.data as AuthStatusPayload;
      setAuth(data);
      if (!data.recording)
        setRows([]);
      else if (data.activityLog !== undefined)
        setRows(data.activityLog);
      const rec = data.recording;
      if (rec?.pendingFormDefaults) {
        setTitle(rec.pendingFormDefaults.title ?? "");
        setDomainsStr((rec.pendingFormDefaults.allowedDomains ?? []).join(", "));
        setTagsStr((rec.pendingFormDefaults.tags ?? []).join(", "));
      }
      return;
    }
    setErr("Could not read status");
  }, []);

  useEffect(() => {
    void readDashboardUrl().then(setDashboard);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
    const onMsg = (msg: { type?: string; row?: ActivityRow }) => {
      if (msg?.type === "openmate.panel.activity" && msg.row) {
        setRows(prev => {
          if (prev.some(r => r.id === msg.row!.id))
            return prev;
          return [...prev, msg.row!];
        });
      } else if (msg?.type === "openmate.panel.poke") {
        void refresh();
      }
    };
    port.onMessage.addListener(onMsg);
    return () => {
      port.onMessage.removeListener(onMsg);
      port.disconnect();
    };
  }, [refresh]);

  useEffect(() => {
    const el = activityRef.current;
    if (!el || !stickBottomRef.current)
      return;
    el.scrollTop = el.scrollHeight;
  }, [rows]);

  const onActivityScroll = useCallback(() => {
    const el = activityRef.current;
    if (!el)
      return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickBottomRef.current = nearBottom;
  }, []);

  const openConnect = useCallback(() => {
    const base = dashboard.replace(/\/$/, "");
    void chrome.tabs.create({ url: `${base}/connect`, active: true });
  }, [dashboard]);

  const startRecording = useCallback(async () => {
    setErr(null);
    setUploadDoneUrl(null);
    try {
      const last = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (last.id === undefined) {
        setErr("No browser window");
        return;
      }
      const tabs = await chrome.tabs.query({ active: true, windowId: last.id });
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        setErr("No active tab in that window");
        return;
      }
      const r = await chrome.runtime.sendMessage({
        type: "openmate.recording.start",
        activeTabId: tabId,
        voicePreference: "off",
      });
      if (r && "ok" in r && r.ok) {
        setRows([]);
        void refresh();
        return;
      }
      const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
        ? String((r.error as { message: string }).message)
        : "Could not start recording";
      setErr(msg);
    } catch {
      setErr("Could not start recording");
    }
  }, [refresh]);

  const signOut = useCallback(async () => {
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.auth.signOutLocal" });
    if (r && "ok" in r && r.ok) {
      setAuth({ status: "signedOut" });
      setRows([]);
    } else {
      setErr("Sign out failed");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    if (!id)
      return;
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.recording.stopForReview", clientRecordingId: id });
    if (!r || !("ok" in r) || !r.ok) {
      const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
        ? String((r.error as { message: string }).message)
        : "Stop failed";
      setErr(msg);
      return;
    }
    void refresh();
  }, [auth?.recording?.clientRecordingId, refresh]);

  const addNote = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    const text = noteDraft.trim();
    if (!id || !text)
      return;
    setErr(null);
    const r = await chrome.runtime.sendMessage({
      type: "openmate.recording.attachNote",
      clientRecordingId: id,
      text,
      tabId: 0,
      timestampMs: Date.now(),
    });
    if (r && "ok" in r && r.ok) {
      setNoteDraft("");
      void refresh();
    } else {
      const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
        ? String((r.error as { message: string }).message)
        : "Note failed";
      setErr(msg);
    }
  }, [auth?.recording?.clientRecordingId, noteDraft]);

  const takeScreenshot = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    if (!id)
      return;
    setErr(null);
    const r = await chrome.runtime.sendMessage({
      type: "openmate.recording.takeScreenshot",
      clientRecordingId: id,
      tabId: 0,
      timestampMs: Date.now(),
    });
    if (!r || !("ok" in r) || !r.ok) {
      const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
        ? String((r.error as { message: string }).message)
        : "Screenshot failed";
      setErr(msg);
      return;
    }
    void refresh();
  }, [auth?.recording?.clientRecordingId, refresh]);

  const submitRecording = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    if (!id)
      return;
    setErr(null);
    const domains = domainsStr.split(",").map(s => s.trim()).filter(Boolean);
    const tags = tagsStr.split(",").map(s => s.trim()).filter(Boolean);
    const r = await chrome.runtime.sendMessage({
      type: "openmate.recording.submit",
      clientRecordingId: id,
      metadata: {
        title: title.trim(),
        humanDescription: humanDescription.trim() || null,
        allowedDomains: domains.length ? domains : [],
        tags,
      },
    });
    if (r && "ok" in r && r.ok) {
      const data = r.data as { dashboardUrl?: string };
      setUploadDoneUrl(data.dashboardUrl ?? null);
      setRows([]);
      void refresh();
      return;
    }
    const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
      ? String((r.error as { message: string }).message)
      : "Submit failed";
    setErr(msg);
    void refresh();
  }, [auth?.recording?.clientRecordingId, domainsStr, humanDescription, tagsStr, title, refresh]);

  const discardRecording = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    if (!id)
      return;
    if (!window.confirm("Discard this recording? This cannot be undone."))
      return;
    setErr(null);
    const r = await chrome.runtime.sendMessage({
      type: "openmate.recording.discard",
      clientRecordingId: id,
      confirmed: true,
    });
    if (r && "ok" in r && r.ok) {
      setRows([]);
      setUploadDoneUrl(null);
      void refresh();
    } else {
      void refresh();
    }
  }, [auth?.recording?.clientRecordingId, refresh]);

  const retryUpload = useCallback(async () => {
    const id = auth?.recording?.clientRecordingId;
    if (!id)
      return;
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.recording.retryUpload", clientRecordingId: id });
    if (r && "ok" in r && r.ok) {
      setUploadDoneUrl(null);
      void refresh();
      return;
    }
    const msg = r && "error" in r && r.error && typeof r.error === "object" && "message" in r.error
      ? String((r.error as { message: string }).message)
      : "Retry failed";
    setErr(msg);
    void refresh();
  }, [auth?.recording?.clientRecordingId, refresh]);

  const status = auth?.status ?? "signedOut";
  const rec = auth?.recording;
  const isRecording = rec?.status === "active" || rec?.status === "starting";
  const isStoppedForm = rec?.status === "stoppedPendingForm";
  const isUploading = rec?.status === "uploading";
  const isUploadFailed = rec?.status === "uploadFailed";

  const label = status === "connected" && auth?.user
    ? isRecording
      ? `Recording — ${rec?.stepCount ?? 0} step(s).`
      : isStoppedForm || isUploading || isUploadFailed
        ? `Recording session: ${rec?.status}`
        : `Connected as ${auth.user.email}`
    : status === "connecting"
      ? "Connecting…"
      : status === "expired"
        ? "Session expired — reconnect from the dashboard"
        : "Not connected — use Connect to sign in on the OpenMate website";

  const showConnect = status === "signedOut" || status === "expired";
  const showStartRecording = status === "connected" && !isRecording && !isStoppedForm && !isUploading && !isUploadFailed;

  return (
    <main className="om-shell om-panel" aria-labelledby="om-panel-title">
      <header className="om-shell__header om-panel__header">
        <img className="om-shell__logo" src={logoSrc} alt="OpenMate" />
        <h1 id="om-panel-title" className="om-shell__title">OpenMate</h1>
        <span className="om-shell__version">{versionLabel}</span>
      </header>

      <p className="om-shell__status om-panel__status" role="status" aria-live="polite">
        {label}
      </p>
      {err && (
        <p className="om-shell__err" role="alert">{err}</p>
      )}
      {uploadDoneUrl && (
        <p className="om-panel__success">
          Uploaded.
          {" "}
          <a href={uploadDoneUrl} target="_blank" rel="noreferrer">Open skill</a>
        </p>
      )}

      <div className="om-shell__row om-panel__row">
        {showConnect && (
          <button type="button" className="om-shell__primary" onClick={openConnect}>
            Connect
          </button>
        )}
        {showStartRecording && (
          <button type="button" className="om-shell__primary" onClick={startRecording}>
            Start recording
          </button>
        )}
        {status === "connected" && !isRecording && !isStoppedForm && !isUploading && !isUploadFailed && (
          <button type="button" className="om-shell__secondary" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>

      {isRecording && rec && (
        <section className="om-panel__controls" aria-label="Recording controls">
          <div className="om-panel__btn-row">
            <button type="button" className="om-shell__secondary om-panel__danger" onClick={() => void stopRecording()}>
              Stop
            </button>
            <button type="button" className="om-shell__secondary" onClick={() => void takeScreenshot()}>
              Screenshot
            </button>
          </div>
          <label className="om-panel__field">
            <span>Note</span>
            <textarea
              className="om-panel__textarea"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="Add a note…"
            />
          </label>
          <button type="button" className="om-shell__primary" onClick={() => void addNote()}>
            Add note
          </button>
        </section>
      )}

      {(isRecording || isStoppedForm || isUploading || isUploadFailed) && (
        <section className="om-panel__controls" aria-label="Activity">
          <h2 className="om-panel__section-title">Activity</h2>
          <div
            className={`om-panel__activity ${isRecording ? "om-panel__activity--tall" : ""}`}
            ref={activityRef}
            onScroll={onActivityScroll}
          >
            {rows.length === 0 && (
              <div className="om-panel__activity-row" style={{ color: "#888" }}>No steps yet.</div>
            )}
            {rows.map(row => (
              <div key={row.id} className="om-panel__activity-row">
                <span className="om-panel__activity-time">{formatOffset(row.offsetMs)}</span>
                {row.summary}
              </div>
            ))}
          </div>
        </section>
      )}

      {isStoppedForm && rec && (
        <section className="om-panel__controls" aria-label="Save recording">
          {rec.stopSummary && (
            <p className="om-panel__status" style={{ margin: 0 }}>
              {rec.stopSummary.stepCount}
              {" "}
              steps ·
              {rec.stopSummary.screenshotCount}
              {" "}
              screenshots ·
              {rec.stopSummary.typedNoteCount}
              {" "}
              notes
            </p>
          )}
          <label className="om-panel__field">
            <span>Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label className="om-panel__field">
            <span>Description (optional)</span>
            <textarea
              className="om-panel__textarea"
              value={humanDescription}
              onChange={e => setHumanDescription(e.target.value)}
            />
          </label>
          <label className="om-panel__field">
            <span>Allowed domains (comma-separated)</span>
            <input value={domainsStr} onChange={e => setDomainsStr(e.target.value)} />
          </label>
          <label className="om-panel__field">
            <span>Tags (comma-separated)</span>
            <input value={tagsStr} onChange={e => setTagsStr(e.target.value)} />
          </label>
          <div className="om-panel__btn-row">
            <button type="button" className="om-shell__primary" onClick={() => void submitRecording()}>
              Submit
            </button>
            <button type="button" className="om-shell__secondary om-panel__danger" onClick={() => void discardRecording()}>
              Discard
            </button>
          </div>
        </section>
      )}

      {isUploading && (
        <p className="om-panel__status">Uploading…</p>
      )}

      {isUploadFailed && (
        <div className="om-panel__btn-row">
          <button type="button" className="om-shell__primary" onClick={() => void retryUpload()}>
            Retry upload
          </button>
          <button type="button" className="om-shell__secondary om-panel__danger" onClick={() => void discardRecording()}>
            Discard
          </button>
        </div>
      )}
    </main>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PanelApp />);
}
