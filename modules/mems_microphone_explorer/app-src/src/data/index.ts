import type { Parameter } from "../types/parameter";
import type { KnowledgeNode, Relationship } from "../types/relationship";
import { EQUATIONS, EQUATION_BY_ID } from "./equations/equations";
import { COMPONENTS, COMPONENT_BY_ID } from "./structure/components";
import { ACOUSTIC_PARAMETERS } from "./parameters/acoustic";
import { MECHANICAL_PARAMETERS } from "./parameters/mechanical";
import { ELECTRICAL_PARAMETERS } from "./parameters/electrical";
import { PERFORMANCE_PARAMETERS } from "./parameters/performance";
import { PARAMETER_PARAMETER_RELATIONSHIPS } from "./relationships/parameter-parameter";
import { PARAMETER_PERFORMANCE_RELATIONSHIPS } from "./relationships/parameter-performance";
import { RESPONSE_FEATURES } from "./response/features";
import { SOURCES, SOURCE_BY_ID } from "./sources/sources";

export { EQUATIONS, EQUATION_BY_ID, COMPONENTS, COMPONENT_BY_ID, SOURCES, SOURCE_BY_ID, RESPONSE_FEATURES };
export { MM20 } from "./microphones/mm20";

export const PARAMETERS: Parameter[] = [
  ...ACOUSTIC_PARAMETERS,
  ...MECHANICAL_PARAMETERS,
  ...ELECTRICAL_PARAMETERS,
  ...PERFORMANCE_PARAMETERS,
];
export const PARAMETER_BY_ID: ReadonlyMap<string, Parameter> = new Map(PARAMETERS.map((p) => [p.id, p]));

export const RELATIONSHIPS: Relationship[] = [
  ...PARAMETER_PARAMETER_RELATIONSHIPS,
  ...PARAMETER_PERFORMANCE_RELATIONSHIPS,
];
export const RELATIONSHIP_BY_ID: ReadonlyMap<string, Relationship> = new Map(RELATIONSHIPS.map((r) => [r.id, r]));

// ── Knowledge nodes: structure, parameters, response features ──
export const NODES: KnowledgeNode[] = [
  ...COMPONENTS.map((c): KnowledgeNode => ({ id: c.id, kind: "structure", label: c.name })),
  ...PARAMETERS.map(
    (p): KnowledgeNode => ({ id: p.id, kind: p.category === "performance" ? "performance" : "parameter", label: p.name }),
  ),
  ...RESPONSE_FEATURES.map((f): KnowledgeNode => ({ id: f.id, kind: "response", label: f.label })),
];
export const NODE_BY_ID: ReadonlyMap<string, KnowledgeNode> = new Map(NODES.map((n) => [n.id, n]));
