import { NOT_PUBLICLY_SPECIFIED } from "../types/evidence";
import type { Parameter } from "../types/parameter";

/** Human-readable value of a parameter; unknown MM20 values always read "Not publicly specified". */
export function formatParameterValue(p: Parameter): { text: string; known: boolean } {
  if (p.textValue) return { text: p.textValue, known: true };
  if (p.value !== undefined) {
    const unit = p.unit ? ` ${p.unit}` : "";
    const range =
      p.min !== undefined || p.max !== undefined
        ? `  (min ${p.min ?? "—"} · max ${p.max ?? "—"})`
        : "";
    return { text: `${p.value}${unit}${range}`, known: true };
  }
  if (p.mm20Status === "not_publicly_specified") return { text: NOT_PUBLICLY_SPECIFIED, known: false };
  return { text: "—", known: false };
}
