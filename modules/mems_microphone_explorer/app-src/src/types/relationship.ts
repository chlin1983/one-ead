import type { Confidence } from "./evidence";

export type RelationshipType = "influences" | "increases" | "decreases" | "determines" | "contributes_to";

export type RelationshipDirection = "positive" | "negative" | "complex";

/** `from` / `to` are knowledge-node ids (structure component, parameter or response feature). */
export interface Relationship {
  id: string;
  from: string;
  to: string;
  relationshipType: RelationshipType;
  direction: RelationshipDirection;
  explanation: string;
  mechanism: string;
  equations?: string[];
  sources: string[];
  confidence: Confidence;
  /** Is this relationship generic MEMS theory or measured/published for the MM20? */
  scope: "generic_mems" | "mm20_specific" | "conceptual";
}

export type KnowledgeNodeKind = "structure" | "parameter" | "response" | "performance";

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
}
