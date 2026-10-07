import { useState } from "react";
import { EQUATION_BY_ID } from "../../data";
import { EvidenceBadge, NotValidatedBadge, ScopeBadge } from "../common/Badges";
import { SourceRefs } from "../SourcePanel/SourceRefs";

export function EquationList({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const eqs = ids.map((id) => EQUATION_BY_ID.get(id)).filter((e) => !!e);
  if (eqs.length === 0) return <div className="text-[12px] text-dim">No equation attached.</div>;
  return (
    <div className="space-y-1.5">
      {eqs.map((e) => {
        const isOpen = open === e.id;
        return (
          <div key={e.id} className="rounded-sm border border-line bg-panel2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
              onClick={() => setOpen(isOpen ? null : e.id)}
            >
              <span>
                <span className="block text-[11px] text-dim">{e.name}</span>
                <span className="font-mono text-[13px] font-semibold">{e.expression}</span>
              </span>
              <span className="text-dim">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="space-y-2 border-t border-line px-2 py-2 text-[12px]">
                <p>{e.description}</p>
                <table className="w-full border-collapse font-mono text-[11px]">
                  <tbody>
                    {e.variables.map((v) => (
                      <tr key={v.symbol} className="border-t border-line">
                        <td className="py-[2px] pr-2 font-semibold">{v.symbol}</td>
                        <td className="pr-2 font-sans">{v.name}</td>
                        <td className="text-right text-dim">{v.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-1">
                  <ScopeBadge scope={e.applicability === "generic" ? "generic_mems" : "conceptual"} />
                  <EvidenceBadge type={e.standardDerivation ? "established_theory" : "derived"} />
                  {e.applicability !== "generic" && <NotValidatedBadge />}
                </div>
                {e.standardDerivation && (
                  <p className="text-dim">
                    <span className="label-mono">Basis · </span>
                    {e.standardDerivation}
                  </p>
                )}
                <SourceRefs ids={e.sources} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
