import type { Confidence, EvidenceType, MM20Status, RecordStatus, Scope } from "./evidence";

export type ParameterCategory = "acoustic" | "mechanical" | "electrical" | "performance";

export interface Parameter {
  id: string;
  name: string;
  category: ParameterCategory;
  description: string;

  unit?: string;

  /** Nominal / typical value. Only present when the value is published or explicitly derived. */
  value?: number;
  min?: number;
  max?: number;
  /** Conditions the value applies to (as printed by the source). */
  conditions?: string;
  /** Verbatim non-numeric value, e.g. "Omnidirectional". */
  textValue?: string;

  scope: Scope;
  evidenceType: EvidenceType;
  confidence: Confidence;

  /** Source ids. Every numeric value must be traceable to at least one. */
  sources: string[];

  equations?: string[];
  relationships?: string[];
  /** Structure component ids this parameter belongs to. */
  relatedComponents?: string[];

  /** Is the MM20 value of this parameter documented? */
  mm20Status: MM20Status;

  notes?: string;
  status: RecordStatus;
}
