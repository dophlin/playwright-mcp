import type { CaptureEventInput, OpenMateExtensionRecorder, SemanticEventType, TargetContextInput } from "@openmate/extension-recorder";
import { afterRecorderMutation, getOpenMateRecorder } from "./recorderHost";
import type { OpenMateActionType, OpenMateRecordingEvent, SelectorCandidate } from "./types";

function candidatesToStrings(c: SelectorCandidate[] | undefined): string[] | undefined {
  if (!c?.length) {
    return undefined;
  }
  return c.map(s => `${s.type}:${s.value}`);
}

function toTargetContext(ev: OpenMateRecordingEvent): TargetContextInput | undefined {
  if (!ev.elementRole && !ev.elementLabel && !ev.selectorCandidates && !ev.boundingRect) {
    return undefined;
  }
  return {
    role: ev.elementRole,
    visibleLabel: ev.elementLabel,
    selectorCandidates: candidatesToStrings(ev.selectorCandidates),
    ...(ev.boundingRect
      ? {
          boundingRect: {
            x: ev.boundingRect.x,
            y: ev.boundingRect.y,
            width: ev.boundingRect.width,
            height: ev.boundingRect.height
          }
        }
      : {})
  };
}

function toSemanticEventType(action: OpenMateActionType): SemanticEventType {
  switch (action) {
    case "keypress":
      return "key";
    case "hover":
      return "hover_reveal";
    case "screenshot":
      return "screenshot";
    case "tab_open":
    case "tab_switch":
    case "tab_close":
      return action;
    default:
      return action as SemanticEventType;
  }
}

/**
 * Forwards a content-script / bridge event to `recorder.capture` with raw values (classification happens in the package).
 */
export function captureFromDomEvent(
  recorder: OpenMateExtensionRecorder,
  ev: OpenMateRecordingEvent,
  opts: { startWallMs: number; tabId: number },
): void {
  if (ev.actionType === "restricted_page") {
    recorder.markUnsupportedContext({ reason: "restricted_page", tabId: opts.tabId });
    afterRecorderMutation();
    return;
  }

  const eventType = toSemanticEventType(ev.actionType);
  const absoluteMs = opts.startWallMs + ev.timestampMs;
  const tctx = toTargetContext(ev);

  const input: CaptureEventInput = {
    eventType,
    tabId: opts.tabId,
    url: ev.url,
    pageTitle: ev.pageTitle,
    timestampMs: absoluteMs,
    ...(tctx ? { targetContext: tctx } : {}),
    ...(ev.value !== undefined && ev.value !== null ? { rawValue: ev.value } : {})
  };
  if (eventType === "key") {
    input.details = {
      key: ev.keyPressed ?? "",
      code: ev.keyPressed ?? "",
      modifiers: [] as string[]
    };
  }
  if (eventType === "scroll") {
    input.details = { milestone: "partial_scroll" };
    input.viewport = { scrollY: 0, scrollX: 0 };
  }
  recorder.capture(input);
  afterRecorderMutation();
}

/**
 * Service-worker entry: resolve recorder and forward; used when the handler has no direct recorder ref.
 */
export function captureDomEventFromExtension(ev: OpenMateRecordingEvent, startWallMs: number, tabId: number): void {
  const r = getOpenMateRecorder();
  if (r.status !== "active") {
    return;
  }
  captureFromDomEvent(r, ev, { startWallMs, tabId });
}
