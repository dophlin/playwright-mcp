/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

const logoSrc = chrome.runtime.getURL('icons/icon-128.png');

const manifestVersion = chrome.runtime.getManifest()?.version;
const versionLabel = manifestVersion && typeof manifestVersion === 'string'
  ? `v${manifestVersion}`
  : 'v?';

const StatusApp: React.FC = () => {
  return (
    <main className='om-shell' aria-labelledby='om-shell-title'>
      <header className='om-shell__header'>
        <img className='om-shell__logo' src={logoSrc} alt='OpenMate' />
        <h1 id='om-shell-title' className='om-shell__title'>OpenMate</h1>
      </header>

      <p className='om-shell__status' role='status'>
        Not connected — sign in to begin
      </p>

      <button
        type='button'
        className='om-shell__primary'
        disabled
        aria-disabled='true'
      >
        Sign In
      </button>

      <footer className='om-shell__footer'>
        <span className='om-shell__version'>{versionLabel}</span>
      </footer>
    </main>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<StatusApp />);
}
