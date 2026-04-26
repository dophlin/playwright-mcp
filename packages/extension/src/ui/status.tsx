/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const logoSrc = chrome.runtime.getURL('icons/icon-128.png');

const manifestVersion = chrome.runtime.getManifest()?.version;
const versionLabel = manifestVersion && typeof manifestVersion === 'string'
  ? `v${manifestVersion}`
  : 'v?';

/** Default “Connect” target; override with `VITE_OPENMATE_DASHBOARD` at build or `openmate_dashboard_url` in storage. */
function defaultDashboardFromEnv(): string {
  const raw = import.meta.env.VITE_OPENMATE_DASHBOARD;
  if (typeof raw === "string" && raw.trim().length) {
    return raw.replace(/\/$/, "");
  }
  return "https://dash-16-58-144-221.nip.io";
}
const DEFAULT_DASHBOARD = defaultDashboardFromEnv();

type AuthStatusPayload = {
  status: string;
  user?: { id: string; email: string; displayName: string | null };
};

async function readDashboardUrl(): Promise<string> {
  const { openmate_dashboard_url: u } = await chrome.storage.local.get("openmate_dashboard_url") as { openmate_dashboard_url?: string };
  if (typeof u === "string" && u.trim().length) {
    return u.replace(/\/$/, "");
  }
  return DEFAULT_DASHBOARD;
}

const StatusApp: React.FC = () => {
  const [auth, setAuth] = useState<AuthStatusPayload | null>(null);
  const [dashboard, setDashboard] = useState(DEFAULT_DASHBOARD);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.auth.getStatus" });
    if (r && "ok" in r && r.ok) {
      setAuth(r.data as AuthStatusPayload);
    } else {
      setErr("Could not read status");
    }
  }, []);

  useEffect(() => {
    void readDashboardUrl().then(setDashboard);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const openConnect = useCallback(() => {
    const base = dashboard.replace(/\/$/, "");
    void chrome.tabs.create({ url: `${base}/connect`, active: true });
  }, [dashboard]);

  const signOut = useCallback(async () => {
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "openmate.auth.signOutLocal" });
    if (r && "ok" in r && r.ok) {
      setAuth({ status: "signedOut" });
    } else {
      setErr("Sign out failed");
    }
  }, []);

  const status = auth?.status ?? "signedOut";
  const label = status === "connected" && auth?.user
    ? `Connected as ${auth.user.email}`
    : status === "connecting"
      ? "Connecting…"
      : status === "expired"
        ? "Session expired — reconnect from the dashboard"
        : "Not connected — use Connect to sign in on the OpenMate website";

  return (
    <main className="om-shell" aria-labelledby="om-shell-title">
      <header className="om-shell__header">
        <img className="om-shell__logo" src={logoSrc} alt="OpenMate" />
        <h1 id="om-shell-title" className="om-shell__title">OpenMate</h1>
      </header>

      <p className="om-shell__status" role="status" aria-live="polite">
        {label}
      </p>
      {err && (
        <p className="om-shell__err" role="alert">{err}</p>
      )}

      <div className="om-shell__row">
        <button type="button" className="om-shell__primary" onClick={openConnect}>
          Connect
        </button>
        {status === "connected" && (
          <button type="button" className="om-shell__secondary" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>

      <footer className="om-shell__footer">
        <span className="om-shell__version">{versionLabel}</span>
      </footer>
    </main>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<StatusApp />);
}
