import type { Relationship } from "../../types/relationship";

type R = Omit<Relationship, "scope" | "confidence"> & Partial<Pick<Relationship, "scope" | "confidence">>;

/** Generic MEMS relationships: textbook theory, not validated against the MM20. */
export function rel(r: R): Relationship {
  return { scope: "generic_mems", confidence: "high", ...r };
}

export const P = "standard-physics";
export const K = "kinsler-2000";
export const B = "beranek-mellow-2012";
export const S = "scheeper-1994";
export const T = "timoshenko-1959";
