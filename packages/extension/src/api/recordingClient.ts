import type { BackendResult } from "./backendClient";
import { fetchJsonWithRefresh, v1Path } from "./backendClient";
import type { FetchJsonContext } from "./backendClient";
import type { UploadSlot } from "../recorder/types";

export type StartSessionResponse = {
  skillId: string;
  sessionId: string;
  recordingConfigurationVersion: string;
  storagePrefix: string;
  uploadSlots: UploadSlot[];
};

export function startRecordingSession(
  ctx: FetchJsonContext,
  body: { recorderVersion: string; initialTitle?: string | null },
): Promise<BackendResult<StartSessionResponse>> {
  return fetchJsonWithRefresh<StartSessionResponse>(ctx, "POST", v1Path("/recording-sessions/start"), body);
}

export function reissueUploads(
  ctx: FetchJsonContext,
  sessionId: string,
  body: { slots?: string[] } = {},
): Promise<BackendResult<{ sessionId: string; uploadSlots: UploadSlot[] }>> {
  return fetchJsonWithRefresh(ctx, "POST", v1Path(`/recording-sessions/${sessionId}/reissue-uploads`), body);
}

export type CompleteResponse = {
  skillId: string;
  sessionId: string;
  status: "verified_queued";
  correlationId: string;
  jobId: string;
};

export function completeRecordingSession(
  ctx: FetchJsonContext,
  sessionId: string,
  body: {
    title?: string;
    humanDescription?: string | null;
    allowedDomains?: string[];
    tags?: string[];
    manifest: Record<string, unknown>;
  },
): Promise<BackendResult<CompleteResponse>> {
  return fetchJsonWithRefresh<CompleteResponse>(ctx, "POST", v1Path(`/recording-sessions/${sessionId}/complete`), body);
}
