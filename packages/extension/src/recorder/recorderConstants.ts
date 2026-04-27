import type { RecorderOptions } from "@openmate/extension-recorder";

const encoder = new TextEncoder();

const idFactory = (prefix: string) => {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const clock: NonNullable<RecorderOptions["clock"]> = () => new Date();

export const defaultRecorderVersion = "0.1.0" as const;

export const maxCapturedTextLength = 120;

/**
 * Construction options for `OpenMateExtensionRecorder` — must stay stable across service-worker activations (FR-013).
 */
export const recorderConstructionOptions: RecorderOptions = {
  clock,
  idFactory,
  defaultRecorderVersion,
  maxCapturedTextLength
};

export function countUtf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
