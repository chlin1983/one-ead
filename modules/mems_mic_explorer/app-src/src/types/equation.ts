import type { Confidence } from "./evidence";

export type EquationDomain = "acoustic" | "mechanical" | "electrical" | "coupled";

export interface EquationVariable {
  symbol: string;
  name: string;
  unit?: string;
}

export interface Equation {
  id: string;
  name: string;
  /** Plain-text form, always rendered. */
  expression: string;
  latex: string;
  description: string;
  domain: EquationDomain;
  variables: EquationVariable[];
  sources: string[];
  applicability: "generic" | "conceptual" | "mm20_not_validated";
  /** Standard derived equations may say so instead of citing a paper (Rule 5). */
  standardDerivation?: string;
  confidence: Confidence;
}
