import type { SensitivityKind, SensitivitySnapshot } from "./types";

function lower(s: string | undefined | null): string {
  return (s ?? "").toLowerCase();
}

const CC_RE = /\b(?:\d[ -]*?){13,19}\b/;
const PHONE_RE = /\+?\d[\d\-\s().]{7,}\d/;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export type InputContext = {
  name?: string | null;
  id?: string | null;
  type?: string | null;
  autocomplete?: string | null;
  labelText?: string | null;
  placeholder?: string | null;
};

export function classifyInput(context: InputContext, rawValue: string | null | undefined): SensitivitySnapshot {
  const t = lower(context.type);
  const ac = lower(context.autocomplete);
  const nm = lower(context.name);
  const id = lower(context.id);
  const label = lower(context.labelText);
  const ph = lower(context.placeholder);
  const combined = [nm, id, label, ph, ac, t].join(" ");
  const value = rawValue ?? "";

  if (t === "password" || ac === "current-password" || ac === "new-password" || combined.includes("password")) {
    return {
      classification: "credential",
      valueCaptured: "omitted",
      reasons: ["password_field"],
    };
  }
  if (
    t === "email"
    || ac.includes("email")
    || combined.includes("email")
    || EMAIL_RE.test(value)
  ) {
    return {
      classification: "suspectedPii",
      valueCaptured: "redacted",
      reasons: ["email_signal"],
    };
  }
  if (ac.includes("cc") || ac.includes("credit") || combined.includes("card") || CC_RE.test(value.replace(/\s/g, ""))) {
    return {
      classification: "payment",
      valueCaptured: "omitted",
      reasons: ["payment_or_card_signal"],
    };
  }
  if (ac.includes("tel") || t === "tel" || PHONE_RE.test(value)) {
    return {
      classification: "suspectedPii",
      valueCaptured: "redacted",
      reasons: ["phone_signal"],
    };
  }
  if (ac.includes("name") || combined.includes("fullname") || combined.includes(" first ") || /^(name|fname|lname|given|family)\b/.test(combined)) {
    return {
      classification: "suspectedPii",
      valueCaptured: "redacted",
      reasons: ["name_signal"],
    };
  }
  return { classification: "none", valueCaptured: "captured", reasons: [] };
}

export function redactValue(classification: SensitivityKind, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined)
    return null;
  if (classification === "credential" || classification === "payment")
    return null;
  if (classification === "suspectedPii" || classification === "redacted")
    return "[redacted]";
  return raw;
}

export function updateGuardSummary(
  summary: { redactedInputCount: number; suspectedPiiCount: number; credentialFieldCount: number; paymentFieldCount: number },
  snap: SensitivitySnapshot,
): void {
  if (snap.classification === "credential")
    summary.credentialFieldCount += 1;
  if (snap.classification === "payment")
    summary.paymentFieldCount += 1;
  if (snap.classification === "suspectedPii" || snap.classification === "redacted")
    summary.suspectedPiiCount += 1;
  if (snap.valueCaptured === "redacted" || snap.valueCaptured === "omitted")
    summary.redactedInputCount += 1;
}
