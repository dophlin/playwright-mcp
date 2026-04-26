/**
 * Records supported workflow events and forwards them to the service worker.
 * Ignores events originating from the OpenMate HUD or marked ignore regions.
 */
import { classifyInput, redactValue, type InputContext } from "../recorder/guardrails";
import type { OpenMateActionType, OpenMateRecordingEvent, SensitivitySnapshot } from "../recorder/types";

const OM_IGNORE = "[data-openmate-ignore-capture], .om-hud-surface, .om-hud-surface *";

let activeId: string | null = null;
let startWall = 0;

function relNow() {
  return Date.now() - startWall;
}

function fromEl(target: EventTarget | null) {
  return target instanceof Element ? target : null;
}

function inIgnoreTree(el: EventTarget | null) {
  const n = fromEl(el);
  if (!n) {
    return false;
  }
  return !!n.closest(OM_IGNORE);
}

function pickLabel(el: Element) {
  const a = el.getAttribute("aria-label");
  if (a) {
    return a;
  }
  const id = el.getAttribute("id");
  if (id) {
    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l?.textContent) {
      return l.textContent.trim();
    }
  }
  return (el as HTMLElement).innerText?.trim()?.slice(0, 200) || undefined;
}

function inputContextFor(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): InputContext {
  return {
    name: el.getAttribute("name"),
    id: el.getAttribute("id"),
    type: el.getAttribute("type"),
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    labelText: pickLabel(el),
    placeholder: el.getAttribute("placeholder") ?? undefined,
  };
}

function makeEvent(
  action: OpenMateActionType,
  extra: Partial<OpenMateRecordingEvent>,
): void {
  if (!activeId) {
    return;
  }
  const ev: OpenMateRecordingEvent = {
    eventId: crypto.randomUUID(),
    sequenceIndex: undefined,
    timestampMs: relNow(),
    tabId: 0,
    actionType: action,
    url: location.href,
    pageTitle: document.title,
    selectorCandidates: extra.selectorCandidates,
    elementRole: extra.elementRole,
    elementLabel: extra.elementLabel,
    boundingRect: extra.boundingRect,
    value: extra.value,
    keyPressed: extra.keyPressed,
    sensitivity: extra.sensitivity ?? { classification: "none", valueCaptured: "captured", reasons: [] },
  };
  void chrome.runtime.sendMessage({
    type: "openmate.recording.event",
    clientRecordingId: activeId,
    event: ev,
  });
}

function onClick(e: MouseEvent) {
  if (!activeId || inIgnoreTree(e.target)) {
    return;
  }
  const t = fromEl(e.target);
  if (!t) {
    return;
  }
  const r = t.getBoundingClientRect();
  const s = classifyInput(
    { name: t.getAttribute("name") ?? undefined, type: t.getAttribute("type") ?? undefined, labelText: pickLabel(t) },
    null,
  );
  makeEvent("click", {
    elementLabel: pickLabel(t),
    elementRole: t.getAttribute("role") || t.tagName.toLowerCase(),
    selectorCandidates: [{ type: "css", value: buildCssPath(t) }],
    boundingRect: { x: r.x, y: r.y, width: r.width, height: r.height },
    sensitivity: s as SensitivitySnapshot,
  });
}

function onInput(e: Event) {
  if (!activeId || inIgnoreTree(e.target)) {
    return;
  }
  const t = e.target;
  if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) {
    return;
  }
  const sens = classifyInput(inputContextFor(t as HTMLInputElement & HTMLTextAreaElement), t.value);
  const v = redactValue(sens.classification, t.value);
  makeEvent("input", {
    value: v,
    elementLabel: pickLabel(t),
    elementRole: t.getAttribute("role") || t.tagName.toLowerCase(),
    selectorCandidates: [{ type: "css", value: buildCssPath(t) }],
    sensitivity: sens as SensitivitySnapshot,
  });
}

function buildCssPath(el: Element): string {
  if (el.id) {
    return `${el.tagName.toLowerCase()}#${CSS.escape(el.id)}`;
  }
  return el.tagName.toLowerCase();
}

function start() {
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
}

function stop() {
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("input", onInput, true);
}

chrome.runtime.onMessage.addListener((
  msg: { type?: string; clientRecordingId?: string; startWallMs?: number },
  _s,
  sendResponse: (r: boolean) => void,
) => {
  if (msg?.type === "openmate.recorder.activate" && msg.clientRecordingId && msg.startWallMs) {
    stop();
    activeId = msg.clientRecordingId;
    startWall = msg.startWallMs;
    start();
    sendResponse(true);
    return true;
  }
  if (msg?.type === "openmate.recorder.refresh" && msg.clientRecordingId && msg.startWallMs) {
    if (msg.clientRecordingId === activeId) {
      startWall = msg.startWallMs;
    }
    sendResponse(true);
    return true;
  }
  return false;
});
