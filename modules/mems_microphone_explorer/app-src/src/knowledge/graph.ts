import type { Equation } from "../types/equation";
import type { Parameter } from "../types/parameter";
import type { Relationship } from "../types/relationship";
import type { StructureComponent } from "../types/structure";
import {
  COMPONENTS,
  COMPONENT_BY_ID,
  EQUATION_BY_ID,
  NODE_BY_ID,
  PARAMETER_BY_ID,
  PARAMETERS,
  RELATIONSHIPS,
  RELATIONSHIP_BY_ID,
} from "../data";
export type EdgeKind = "relationship" | "structural";

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  relationship?: Relationship;
}

// Structure → parameter edges are derived from each component's parameterIds so they never drift
// from the component definition.
const structuralEdges: Edge[] = COMPONENTS.flatMap((c) =>
  c.parameterIds.map((pid) => ({ id: `struct.${c.id}->${pid}`, from: c.id, to: pid, kind: "structural" as const })),
);
const relationshipEdges: Edge[] = RELATIONSHIPS.map((r) => ({
  id: r.id,
  from: r.from,
  to: r.to,
  kind: "relationship" as const,
  relationship: r,
}));

export const EDGES: Edge[] = [...structuralEdges, ...relationshipEdges];

const outgoing = new Map<string, Edge[]>();
const incoming = new Map<string, Edge[]>();
for (const e of EDGES) {
  (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e);
  (incoming.get(e.to) ?? incoming.set(e.to, []).get(e.to)!).push(e);
}

export function edgesFrom(id: string): Edge[] {
  return outgoing.get(id) ?? [];
}
export function edgesTo(id: string): Edge[] {
  return incoming.get(id) ?? [];
}

/** Breadth-first traversal in either direction (STRUCTURE → … → PERFORMANCE, or back). */
export function traverse(startId: string, direction: "forward" | "backward", maxDepth = 6): Edge[] {
  const seen = new Set<string>([startId]);
  const result: Edge[] = [];
  let frontier = [startId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of direction === "forward" ? edgesFrom(id) : edgesTo(id)) {
        result.push(e);
        const other = direction === "forward" ? e.to : e.from;
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return result;
}

export function parametersOfComponent(c: StructureComponent): Parameter[] {
  return c.parameterIds.map((id) => PARAMETER_BY_ID.get(id)).filter((p): p is Parameter => !!p);
}

export function equationsOfComponent(c: StructureComponent): Equation[] {
  return c.equationIds.map((id) => EQUATION_BY_ID.get(id)).filter((e): e is Equation => !!e);
}

export function relationshipsOfComponent(c: StructureComponent): Relationship[] {
  return c.impactRelationshipIds.map((id) => RELATIONSHIP_BY_ID.get(id)).filter((r): r is Relationship => !!r);
}

export function nodeLabel(id: string): string {
  return NODE_BY_ID.get(id)?.label ?? id;
}

/** Relationship ids touching a parameter, computed from the single relationship database. */
export function relationshipsOfParameter(id: string): Relationship[] {
  return RELATIONSHIPS.filter((r) => r.from === id || r.to === id);
}

export function componentsOfParameter(p: Parameter): StructureComponent[] {
  return (p.relatedComponents ?? []).map((id) => COMPONENT_BY_ID.get(id)).filter((c): c is StructureComponent => !!c);
}

export { PARAMETERS };
