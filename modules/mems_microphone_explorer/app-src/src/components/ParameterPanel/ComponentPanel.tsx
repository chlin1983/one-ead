import { COMPONENT_BY_ID, SOURCE_BY_ID } from "../../data";
import { formatParameterValue } from "../../lib/format";
import { parametersOfComponent, relationshipsOfComponent } from "../../knowledge/graph";
import { NOT_PUBLICLY_SPECIFIED } from "../../types/evidence";
import { EvidenceBadges } from "../common/Badges";
import { Section } from "../common/Section";
import { EquationList } from "../EquationPanel/EquationList";
import { RelationshipRow } from "../RelationshipGraph/RelationshipList";
import { SourceRefs } from "../SourcePanel/SourceRefs";

export function ComponentPanel({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const c = COMPONENT_BY_ID.get(id);
  if (!c) return <div className="text-concept">Unknown component “{id}”.</div>;
  const params = parametersOfComponent(c);
  const impacts = relationshipsOfComponent(c);

  return (
    <div className="space-y-3 text-[12.5px]">
      <header className="space-y-1">
        <div className="label-mono">Structure component</div>
        <h2 className="text-[16px] font-semibold leading-tight">{c.name}</h2>
        <EvidenceBadges scope={c.scope} evidenceType={c.evidenceType} confidence={c.confidence} mm20Status={c.mm20Status} />
        {c.conceptualGeometry && (
          <div className="rounded-sm border border-concept bg-concept/10 px-2 py-1 text-[11.5px] text-concept">
            Conceptual MEMS architecture — the drawn geometry is illustrative, not the actual MM20 construction.
          </div>
        )}
      </header>

      <Section title="Function">
        <p>{c.function}</p>
      </Section>

      <Section title="Physical mechanism">
        <p>{c.mechanism}</p>
      </Section>

      <Section title="MM20-specific status">
        {c.mm20Facts && c.mm20Facts.length > 0 ? (
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {c.mm20Facts.map((f) => (
                <tr key={f.label} className="border-t border-line align-top">
                  <td className="w-[38%] py-1 pr-2 text-dim">{f.label}</td>
                  <td className="py-1 pr-1 font-mono">{f.value}</td>
                  <td className="py-1 text-right">
                    <SourceTag id={f.sourceId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="italic text-unknown">{NOT_PUBLICLY_SPECIFIED}</div>
        )}
        {c.mm20Note && <p className="text-dim">{c.mm20Note}</p>}
      </Section>

      <Section title={`Parameters (${params.length})`}>
        {params.length === 0 ? (
          <div className="text-dim">No parameters attached.</div>
        ) : (
          <ul className="divide-y divide-line rounded-sm border border-line">
            {params.map((p) => {
              const v = formatParameterValue(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(p.id)}
                    className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left hover:bg-accentsoft"
                  >
                    <span>
                      {p.name}
                      <span className="ml-1.5 font-mono text-[9.5px] uppercase text-dim">
                        {p.scope === "mm20_specific" ? "MM20" : p.scope === "generic_mems" ? "generic" : p.scope}
                      </span>
                    </span>
                    <span className={`max-w-[48%] truncate font-mono text-[11px] ${v.known ? "" : "italic text-unknown"}`} title={v.text}>
                      {v.known ? v.text : v.text === NOT_PUBLICLY_SPECIFIED ? "n/p/s" : v.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="font-mono text-[10px] text-dim">n/p/s = {NOT_PUBLICLY_SPECIFIED} (generic concept; no MM20 value documented)</div>
      </Section>

      <Section title="Equations">
        <EquationList ids={c.equationIds} />
      </Section>

      <Section title="Performance impact">
        <p>{c.performanceImpact}</p>
        {impacts.length > 0 && (
          <div className="space-y-1">
            {impacts.map((r) => (
              <RelationshipRow key={r.id} r={r} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Traceability">
        <SourceRefs ids={c.sources} />
        <div className="font-mono text-[10.5px] text-dim">record: {c.id}</div>
      </Section>
    </div>
  );
}

function SourceTag({ id }: { id: string }) {
  const s = SOURCE_BY_ID.get(id);
  if (!s) return <span className="text-concept">⚠ {id}</span>;
  const loc = [s.table, s.figure, s.page ? `p.${s.page}` : undefined].filter(Boolean).join(" · ");
  return (
    <a
      className="font-mono text-[10.5px] text-accent underline decoration-dotted"
      href={s.url}
      target="_blank"
      rel="noreferrer"
      title={s.title}
    >
      {loc || "datasheet"}
    </a>
  );
}
