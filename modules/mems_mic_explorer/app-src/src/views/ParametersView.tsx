import { useMemo, useState } from "react";
import { COMPONENT_BY_ID, PARAMETERS } from "../data";
import { formatParameterValue } from "../lib/format";
import type { ParameterCategory } from "../types/parameter";
import { ComponentPanel } from "../components/ParameterPanel/ComponentPanel";
import { ParameterDetail } from "../components/ParameterPanel/ParameterDetail";
import { ScopeBadge } from "../components/common/Badges";

const CATS: (ParameterCategory | "all")[] = ["all", "acoustic", "mechanical", "electrical", "performance"];

/** Phase 1 parameter browser: lists every parameter with its scope and opens its traceable detail. */
export function ParametersView() {
  const [cat, setCat] = useState<ParameterCategory | "all">("all");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string>("mech.diaphragm_stiffness");

  const list = useMemo(
    () =>
      PARAMETERS.filter((p) => (cat === "all" || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())),
    [cat, q],
  );
  const isComponent = COMPONENT_BY_ID.has(detailId);

  return (
    <div className="grid h-full min-h-0 grid-cols-[420px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
        <div className="space-y-2 border-b border-line p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search parameters…"
            className="w-full rounded-sm border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`rounded-sm border px-2 py-[2px] font-mono text-[10.5px] uppercase tracking-wider ${
                  cat === c ? "border-accent bg-accentsoft text-accent" : "border-line text-dim hover:border-accent"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="font-mono text-[10.5px] text-dim">{list.length} parameters</div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {list.map((p) => {
            const v = formatParameterValue(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(p.id)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left ${
                    detailId === p.id ? "bg-accentsoft" : "hover:bg-panel2"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <ScopeBadge scope={p.scope} />
                  </span>
                  <span className={`truncate font-mono text-[11px] ${v.known ? "text-dim" : "italic text-unknown"}`}>
                    {v.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="min-h-0 overflow-y-auto p-5">
        <div className="mx-auto max-w-[760px]">
          {isComponent ? (
            <ComponentPanel id={detailId} onNavigate={setDetailId} />
          ) : (
            <ParameterDetail id={detailId} onNavigate={setDetailId} />
          )}
        </div>
      </main>
    </div>
  );
}
