import { useState } from "react";
import { edgesFrom, edgesTo, nodeLabel } from "../../knowledge/graph";
import type { Relationship } from "../../types/relationship";
import { ConfidenceBadge } from "../common/Badges";
import { SourceRefs } from "../SourcePanel/SourceRefs";
import { EquationList } from "../EquationPanel/EquationList";

const ARROW: Record<Relationship["direction"], string> = { positive: "↑ ↑", negative: "↑ ↓", complex: "↝" };
const DIR_TEXT: Record<Relationship["direction"], string> = {
  positive: "same direction",
  negative: "opposite direction",
  complex: "complex dependence",
};

export function RelationshipRow({ r, onNavigate }: { r: Relationship; onNavigate: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-sm border border-line bg-panel2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 px-2 py-1.5 text-left">
        <span className="mt-[1px] font-mono text-[11px] text-accent" title={DIR_TEXT[r.direction]}>
          {ARROW[r.direction]}
        </span>
        <span className="min-w-0 flex-1 text-[12px]">
          <span className="block">
            <NodeLink id={r.from} onNavigate={onNavigate} /> <span className="text-dim">→</span>{" "}
            <NodeLink id={r.to} onNavigate={onNavigate} />
          </span>
          <span className="block text-dim">{r.explanation}</span>
        </span>
        <span className="text-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-2 py-2 text-[12px]">
          <p>
            <span className="label-mono">Mechanism · </span>
            {r.mechanism}
          </p>
          <div className="flex flex-wrap gap-1">
            <ConfidenceBadge level={r.confidence} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-generic">
              {r.scope === "generic_mems" ? "Generic MEMS theory" : r.scope}
            </span>
          </div>
          {r.equations && r.equations.length > 0 && <EquationList ids={r.equations} />}
          <SourceRefs ids={r.sources} />
        </div>
      )}
    </div>
  );
}

function NodeLink({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  return (
    <button
      type="button"
      className="font-semibold text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(id);
      }}
    >
      {nodeLabel(id)}
    </button>
  );
}

/** Both directions of the knowledge graph for one node: what drives it, and what it drives. */
export function RelationshipList({ nodeId, onNavigate }: { nodeId: string; onNavigate: (id: string) => void }) {
  const out = edgesFrom(nodeId).filter((e) => e.relationship);
  const inn = edgesTo(nodeId).filter((e) => e.relationship);
  if (out.length === 0 && inn.length === 0) return <div className="text-[12px] text-dim">No relationships recorded.</div>;
  return (
    <div className="space-y-2">
      {inn.length > 0 && (
        <div>
          <div className="label-mono mb-1">← Driven by (backward)</div>
          <div className="space-y-1">
            {inn.map((e) => (
              <RelationshipRow key={e.id} r={e.relationship!} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
      {out.length > 0 && (
        <div>
          <div className="label-mono mb-1">Influences → (forward)</div>
          <div className="space-y-1">
            {out.map((e) => (
              <RelationshipRow key={e.id} r={e.relationship!} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
