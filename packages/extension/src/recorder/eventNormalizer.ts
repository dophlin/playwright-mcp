import { classifyInput, redactValue, type InputContext } from "./guardrails";
import type { OpenMateActionType, OpenMateRecordingEvent, SelectorCandidate, SensitivitySnapshot } from "./types";
import { randomId } from "./ids";

export type RawRecorderEvent = {
  actionType: OpenMateActionType;
  tabId: number;
  timestampMs: number;
  url?: string;
  pageTitle?: string;
  selectorCandidates?: SelectorCandidate[];
  elementRole?: string;
  elementLabel?: string;
  boundingRect?: { x: number; y: number; width: number; height: number };
  value?: string | null;
  keyPressed?: string;
  inputContext?: InputContext;
};

function sensitivityFor(raw: RawRecorderEvent): SensitivitySnapshot {
  if (raw.actionType === "input" && raw.inputContext) {
    return classifyInput(raw.inputContext, raw.value ?? null);
  }
  return { classification: "none", valueCaptured: "captured", reasons: [] };
}

export function normalizeRawRecorderEvent(raw: RawRecorderEvent): OpenMateRecordingEvent {
  const sensitivity = sensitivityFor(raw);
  const v = raw.actionType === "input" && raw.value != null
    ? redactValue(sensitivity.classification, raw.value)
    : (raw.value ?? null);

  return {
    eventId: randomId(),
    timestampMs: raw.timestampMs,
    tabId: raw.tabId,
    actionType: raw.actionType,
    url: raw.url,
    pageTitle: raw.pageTitle,
    selectorCandidates: raw.selectorCandidates,
    elementRole: raw.elementRole,
    elementLabel: raw.elementLabel,
    boundingRect: raw.boundingRect,
    value: v,
    keyPressed: raw.keyPressed,
    sensitivity,
  };
}
