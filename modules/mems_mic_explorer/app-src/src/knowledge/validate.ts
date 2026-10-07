import {
  COMPONENTS,
  EQUATIONS,
  EQUATION_BY_ID,
  NODE_BY_ID,
  NODES,
  PARAMETERS,
  PARAMETER_BY_ID,
  RELATIONSHIPS,
  SOURCES,
  SOURCE_BY_ID,
} from "../data";

export interface Issue {
  severity: "error" | "warning";
  rule: string;
  record: string;
  message: string;
}

/** Enforces the data-integrity rules (traceability, MM20 vs generic vs conceptual separation). */
export function validateKnowledge(): Issue[] {
  const issues: Issue[] = [];
  const err = (rule: string, record: string, message: string) => issues.push({ severity: "error", rule, record, message });
  const warn = (rule: string, record: string, message: string) => issues.push({ severity: "warning", rule, record, message });

  const checkUnique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err("unique-id", id, `Duplicate ${kind} id`);
      seen.add(id);
    }
  };
  checkUnique("source", SOURCES.map((s) => s.id));
  checkUnique("parameter", PARAMETERS.map((p) => p.id));
  checkUnique("equation", EQUATIONS.map((e) => e.id));
  checkUnique("relationship", RELATIONSHIPS.map((r) => r.id));
  checkUnique("component", COMPONENTS.map((c) => c.id));
  checkUnique("node", NODES.map((n) => n.id));

  const needSources = (record: string, sources: string[]) => {
    for (const sid of sources) if (!SOURCE_BY_ID.has(sid)) err("source-exists", record, `Unknown source id "${sid}"`);
  };
  const isMm20Source = (sid: string) => SOURCE_BY_ID.get(sid)?.sourceType === "manufacturer_datasheet";

  for (const p of PARAMETERS) {
    needSources(p.id, p.sources);
    const hasNumber = p.value !== undefined || p.min !== undefined || p.max !== undefined;

    // Rule 4: every published numerical value has a source.
    if ((hasNumber || p.textValue) && p.sources.length === 0) err("R4-source-required", p.id, "Value without a source");
    if (p.sources.length === 0) warn("R4-source-required", p.id, "Parameter has no source");

    // Rule 2: generic parameters never carry an MM20 value.
    if (p.scope === "generic_mems" && (hasNumber || p.textValue)) {
      err("R2-generic-not-mm20", p.id, "Generic MEMS parameter must not hold a numeric/text value");
    }
    // Rule 1/7: unknown MM20 data must not carry a value.
    if (p.mm20Status === "not_publicly_specified" && p.scope === "mm20_specific") {
      err("R1-no-invented-mm20", p.id, "mm20_specific parameter marked not publicly specified");
    }
    if (p.scope === "mm20_specific") {
      if (p.evidenceType !== "manufacturer_published") err("R8-separation", p.id, "mm20_specific must be manufacturer_published");
      if (!p.sources.some(isMm20Source)) err("R9-source-supports", p.id, "mm20_specific parameter without manufacturer source");
      if (p.mm20Status !== "published") err("R8-separation", p.id, "mm20_specific must have mm20Status 'published'");
    }
    if (p.evidenceType === "manufacturer_published" && p.scope !== "mm20_specific") {
      err("R8-separation", p.id, "manufacturer_published value must be scope mm20_specific");
    }
    // Rule 10: derived/conceptual values must be flagged.
    if (hasNumber && p.scope === "derived" && !p.conditions && !p.notes) {
      warn("R10-false-precision", p.id, "Derived value without explanation");
    }
    for (const eid of p.equations ?? []) if (!EQUATION_BY_ID.has(eid)) err("ref-exists", p.id, `Unknown equation "${eid}"`);
    for (const cid of p.relatedComponents ?? []) {
      if (!COMPONENTS.some((c) => c.id === cid)) err("ref-exists", p.id, `Unknown component "${cid}"`);
    }
  }

  for (const e of EQUATIONS) {
    needSources(e.id, e.sources);
    // Rule 5
    if (e.sources.length === 0 && !e.standardDerivation) err("R5-equation-source", e.id, "No source and no standard derivation");
    if (e.variables.length === 0) err("equation-vars", e.id, "Equation has no variables");
  }

  for (const r of RELATIONSHIPS) {
    needSources(r.id, r.sources);
    if (!NODE_BY_ID.has(r.from)) err("ref-exists", r.id, `Unknown 'from' node "${r.from}"`);
    if (!NODE_BY_ID.has(r.to)) err("ref-exists", r.id, `Unknown 'to' node "${r.to}"`);
    // Rule 6
    if (!r.confidence) err("R6-evidence-level", r.id, "Missing confidence");
    if (!r.mechanism || !r.explanation) err("R6-evidence-level", r.id, "Missing mechanism/explanation");
    if (r.sources.length === 0) err("R4-source-required", r.id, "Relationship without a source");
    for (const eid of r.equations ?? []) if (!EQUATION_BY_ID.has(eid)) err("ref-exists", r.id, `Unknown equation "${eid}"`);
  }

  for (const c of COMPONENTS) {
    needSources(c.id, c.sources);
    for (const pid of c.parameterIds) if (!PARAMETER_BY_ID.has(pid)) err("ref-exists", c.id, `Unknown parameter "${pid}"`);
    for (const eid of c.equationIds) if (!EQUATION_BY_ID.has(eid)) err("ref-exists", c.id, `Unknown equation "${eid}"`);
    for (const rid of c.impactRelationshipIds) {
      if (!RELATIONSHIPS.some((r) => r.id === rid)) err("ref-exists", c.id, `Unknown relationship "${rid}"`);
    }
    if (c.mm20Status === "published" && !(c.mm20Facts?.length)) err("R4-source-required", c.id, "Published MM20 status without facts");
    for (const f of c.mm20Facts ?? []) {
      if (!SOURCE_BY_ID.has(f.sourceId)) err("source-exists", c.id, `Fact "${f.label}" cites unknown source "${f.sourceId}"`);
    }
  }

  return issues;
}
