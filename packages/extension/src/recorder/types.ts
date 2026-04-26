export type ExtensionAuthStatus = "signedOut" | "connecting" | "connected" | "expired";

export type ExtensionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type ExtensionSessionState = {
  user: ExtensionUser;
  clientKind: "browser_extension";
  status: ExtensionAuthStatus;
  encryptedRefreshToken: string;
  lastRefreshedAt?: string;
};

export type VoiceStatus =
  | "unknown"
  | "prompting"
  | "on"
  | "muted"
  | "off"
  | "unavailable"
  | "failed";

export type RecordingLifecycleStatus =
  | "idle"
  | "starting"
  | "active"
  | "stoppedPendingForm"
  | "uploading"
  | "uploadFailed"
  | "uploaded"
  | "discarded";

export type TabRecordStatus = "supported" | "restricted" | "injectionFailed" | "closed";

export type SensitivityKind =
  | "none"
  | "suspectedPii"
  | "credential"
  | "payment"
  | "redacted";

export type SensitivitySnapshot = {
  classification: SensitivityKind;
  valueCaptured: "captured" | "redacted" | "omitted";
  reasons: string[];
};

export type SelectorCandidate = { type: "css" | "aria" | "text"; value: string };

export type OpenMateActionType =
  | "click"
  | "input"
  | "navigate"
  | "scroll"
  | "hover"
  | "keypress"
  | "select"
  | "tab_open"
  | "tab_switch"
  | "tab_close"
  | "restricted_page"
  | "screenshot";

export type OpenMateRecordingEvent = {
  eventId: string;
  sequenceIndex?: number;
  timestampMs: number;
  tabId: number;
  actionType: OpenMateActionType;
  url?: string;
  pageTitle?: string;
  selectorCandidates?: SelectorCandidate[];
  elementRole?: string;
  elementLabel?: string;
  boundingRect?: { x: number; y: number; width: number; height: number };
  value?: string | null;
  keyPressed?: string;
  sensitivity: SensitivitySnapshot;
};

export type RecordedTabState = {
  tabId: number;
  windowId?: number;
  firstSeenAt: string;
  lastSeenAt?: string;
  currentUrl?: string;
  currentTitle?: string;
  status: TabRecordStatus;
};

export type UploadSlot = {
  slot: string;
  objectKey: string;
  uploadUrl: string;
  required: boolean;
};

export type PendingUploadState = {
  clientRecordingId: string;
  backendSessionId: string;
  skillId: string;
  recordingConfigurationVersion: string;
  storagePrefix: string;
  uploadSlots: UploadSlot[];
  lastErrorCode?: string;
  updatedAt: string;
};

export type SkillMetadataDraft = {
  title: string;
  humanDescription?: string | null;
  allowedDomains: string[];
  tags: string[];
};

export type GuardrailSummary = {
  redactedInputCount: number;
  suspectedPiiCount: number;
  credentialFieldCount: number;
  paymentFieldCount: number;
};

export type OpenMateRecordingSessionState = {
  clientRecordingId: string;
  backendSessionId?: string;
  skillId?: string;
  recordingConfigurationVersion?: string;
  status: RecordingLifecycleStatus;
  startedAt: string;
  endedAt?: string;
  startingUrl?: string;
  startingTabTitle?: string;
  activeTabId?: number;
  visitedDomains: string[];
  stepCount: number;
  voiceStatus: VoiceStatus;
  events: OpenMateRecordingEvent[];
  tabMeta: Map<number, RecordedTabState>;
  /** Presigned targets from the last /recording-sessions/start or reissue call. */
  sessionUploadSlots: UploadSlot[];
  eventsJsonUploadSlot?: { objectKey: string; uploadUrl: string };
  pendingFormDefaults?: {
    title: string;
    allowedDomains: string[];
    tags: string[];
  };
  stopSummary?: {
    stepCount: number;
    voiceDurationMs: number;
    typedNoteCount: number;
    screenshotCount: number;
  };
  voiceDurationMs: number;
  typedNoteCount: number;
  screenshotCount: number;
  guardrailSummary: GuardrailSummary;
  typedNotes: TypedNoteRecord[];
  screenshots: ScreenshotRecord[];
};

export type VoicePreference = "prompt" | "on" | "off";

export type TypedNoteRecord = {
  noteId: string;
  text: string;
  tabId: number;
  timestampMs: number;
  nearestEventId: string | null;
};

export type ScreenshotRecord = {
  screenshotId: string;
  tabId: number;
  timestampMs: number;
  /** PNG bytes for required upload slot when no live capture exists. */
  png?: ArrayBuffer;
};
