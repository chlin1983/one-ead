// Shared classification vocabularies used by every knowledge record.

export type EvidenceType =
  | "manufacturer_published"
  | "peer_reviewed"
  | "established_theory"
  | "derived"
  | "conceptual"
  | "assumption";

export type Confidence = "very_high" | "high" | "medium" | "low";

export type Scope = "mm20_specific" | "generic_mems" | "conceptual" | "derived";

export type RecordStatus = "draft" | "reviewed" | "published";

/**
 * Whether the MM20 value of a record is actually documented.
 * "not_publicly_specified" must always be rendered as exactly that text.
 */
export type MM20Status = "published" | "not_publicly_specified" | "not_applicable";

export const NOT_PUBLICLY_SPECIFIED = "Not publicly specified";
