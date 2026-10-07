import { COMPONENT_BY_ID, PARAMETER_BY_ID } from "../../data";
import { formatParameterValue } from "../../lib/format";
import { EvidenceBadges } from "../common/Badges";
import { Section } from "../common/Section";
import { EquationList } from "../EquationPanel/EquationList";
import { RelationshipList } from "../RelationshipGraph/RelationshipList";
import { SourceRefs } from "../SourcePanel/SourceRefs";

export function ParameterDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const p = PARAMETER_BY_ID.get(id);
  if (!p) return <div className="text-concept">Unknown parameter “{id}”.</div>;
  const v = formatParameterValue(p);
  return (
    <div className="space-y-3 text-[12.5px]">
      <header className="space-y-1">
        <div className="label-mono">{p.category} parameter</div>
        <h2 className="text-[16px] font-semibold leading-tight">{p.name}</h2>
        <EvidenceBadges
          scope={p.scope}
          evidenceType={p.evidenceType}
          confidence={p.confidence}
          mm20Status={p.mm20Status}
          notValidated={p.scope === "conceptual" || p.scope === "derived"}
        />
      </header>

      <p>{p.description}</p>

      <Section title="Value">
        <div className={`font-mono text-[13px] ${v.known ? "" : "text-unknown italic"}`}>{v.text}</div>
        {p.conditions && <div className="text-dim">Conditions: {p.conditions}</div>}
        {p.scope === "generic_mems" && (
          <div className="text-dim">Generic MEMS concept — shown without a value because no MM20 value is documented.</div>
        )}
      </Section>

      {p.notes && (
        <Section title="Notes">
          <p className="text-dim">{p.notes}</p>
        </Section>
      )}

      {p.relatedComponents && p.relatedComponents.length > 0 && (
        <Section title="Related structure">
          <div className="flex flex-wrap gap-1">
            {p.relatedComponents.map((cid) => (
              <button
                key={cid}
                type="button"
                className="rounded-sm border border-line px-1.5 py-[2px] text-[11px] hover:border-accent hover:text-accent"
                onClick={() => onNavigate(cid)}
              >
                {COMPONENT_BY_ID.get(cid)?.name ?? cid}
              </button>
            ))}
          </div>
        </Section>
      )}

      {p.equations && p.equations.length > 0 && (
        <Section title="Equations">
          <EquationList ids={p.equations} />
        </Section>
      )}

      <Section title="Relationships">
        <RelationshipList nodeId={p.id} onNavigate={onNavigate} />
      </Section>

      <Section title="Traceability">
        <SourceRefs ids={p.sources} />
        <div className="font-mono text-[10.5px] text-dim">
          record: {p.id} · status: {p.status}
        </div>
      </Section>
    </div>
  );
}
