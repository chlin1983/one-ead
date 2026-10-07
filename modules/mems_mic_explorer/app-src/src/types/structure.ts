import type { Confidence, EvidenceType, MM20Status, Scope } from "./evidence";

/** A physical building block of the (conceptual) MEMS microphone model. */
export interface StructureComponent {
  id: string;
  name: string;
  /** Short label for 3D annotations. */
  label: string;
  function: string;
  /** Physical mechanism in words (feeds the Mechanism step of the learning chain). */
  mechanism: string;

  parameterIds: string[];
  equationIds: string[];
  /** Relationship ids describing the performance impact. */
  impactRelationshipIds: string[];
  performanceImpact: string;

  scope: Scope;
  evidenceType: EvidenceType;
  confidence: Confidence;
  sources: string[];

  /** What is known about this element in the MM20 specifically. */
  mm20Status: MM20Status;
  mm20Facts?: { label: string; value: string; sourceId: string }[];
  mm20Note?: string;

  /** True when the drawn geometry is illustrative, not the actual MM20 construction. */
  conceptualGeometry: boolean;
}
