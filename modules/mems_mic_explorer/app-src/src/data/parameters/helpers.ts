import type { Parameter, ParameterCategory } from "../../types/parameter";
import type { Source } from "../../types/source";
import {
  MM20_FEATURES,
  MM20_FIG1,
  MM20_MECH,
  MM20_TABLE1,
} from "../sources/knowles-mm20";
import {
  BERANEK_MELLOW,
  KINSLER,
  SCHEEPER,
  STANDARD_PHYSICS,
  TIMOSHENKO,
} from "../sources/mems-literature";

export const SRC = {
  table1: MM20_TABLE1.id,
  fig1: MM20_FIG1.id,
  mech: MM20_MECH.id,
  features: MM20_FEATURES.id,
  beranek: BERANEK_MELLOW.id,
  kinsler: KINSLER.id,
  scheeper: SCHEEPER.id,
  timoshenko: TIMOSHENKO.id,
  physics: STANDARD_PHYSICS.id,
} satisfies Record<string, Source["id"]>;

type Common = {
  id: string;
  name: string;
  category: ParameterCategory;
  description: string;
  unit?: string;
  equations?: string[];
  relationships?: string[];
  relatedComponents?: string[];
  notes?: string;
};

/**
 * A generic MEMS engineering concept. The MM20 value is not documented, so none is stored
 * (Rule 1 / Rule 7).
 */
export function generic(p: Common & { sources: string[] }): Parameter {
  return {
    ...p,
    scope: "generic_mems",
    evidenceType: "established_theory",
    confidence: "high",
    mm20Status: "not_publicly_specified",
    status: "draft",
  };
}

/** A value read directly from the MM20 datasheet. */
export function mm20(
  p: Common & {
    value?: number;
    min?: number;
    max?: number;
    conditions?: string;
    textValue?: string;
    sources: string[];
  },
): Parameter {
  return {
    ...p,
    scope: "mm20_specific",
    evidenceType: "manufacturer_published",
    confidence: "very_high",
    mm20Status: "published",
    status: "reviewed",
  };
}

/** A value computed by this application from published values or from a standard relation. */
export function derived(
  p: Common & {
    value?: number;
    conditions?: string;
    sources: string[];
    confidence?: Parameter["confidence"];
    mm20Status?: Parameter["mm20Status"];
  },
): Parameter {
  const { confidence, mm20Status, ...rest } = p;
  return {
    ...rest,
    scope: "derived",
    evidenceType: "derived",
    confidence: confidence ?? "high",
    mm20Status: mm20Status ?? "not_applicable",
    status: "draft",
  };
}
