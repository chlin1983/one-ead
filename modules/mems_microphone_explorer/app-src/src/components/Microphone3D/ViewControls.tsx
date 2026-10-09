import { COMPONENTS } from "../../data";
import { Section } from "../common/Section";
import type { ViewState } from "./MicrophoneScene";

interface Props {
  view: ViewState;
  setView: (v: ViewState) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResetCamera: () => void;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-[3px]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
    </label>
  );
}

export function ViewControls({ view, setView, selectedId, onSelect, onResetCamera }: Props) {
  const toggleHidden = (id: string) => {
    const next = new Set(view.hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setView({ ...view, hidden: next });
  };

  return (
    <div className="space-y-4 text-[12px]">
      <Section title="View">
        <label className="block">
          <div className="flex justify-between">
            <span>Exploded view</span>
            <span className="font-mono text-dim">{Math.round(view.explode * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={view.explode}
            onChange={(e) => setView({ ...view, explode: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <Toggle label="Cutaway (open can)" checked={view.cutaway} onChange={(v) => setView({ ...view, cutaway: v })} />
        <Toggle
          label="Transparent package"
          checked={view.transparentPackage}
          onChange={(v) => setView({ ...view, transparentPackage: v })}
        />
        <Toggle label="Component labels" checked={view.labels} onChange={(v) => setView({ ...view, labels: v })} />
        <button
          type="button"
          onClick={onResetCamera}
          className="mt-1 w-full rounded-sm border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider hover:border-accent hover:text-accent"
        >
          Reset camera
        </button>
      </Section>

      <Section title="Components">
        <ul className="space-y-[2px]">
          {COMPONENTS.map((c) => {
            const hidden = view.hidden.has(c.id);
            const selected = selectedId === c.id;
            return (
              <li
                key={c.id}
                className={`flex items-center gap-1.5 rounded-sm border px-1.5 py-[3px] ${
                  selected ? "border-accent bg-accentsoft" : "border-transparent hover:border-line"
                }`}
              >
                <button
                  type="button"
                  title={hidden ? "Show" : "Hide"}
                  onClick={() => toggleHidden(c.id)}
                  className={`w-4 text-center font-mono text-[11px] ${hidden ? "text-dim opacity-50" : "text-accent"}`}
                >
                  {hidden ? "○" : "●"}
                </button>
                <button type="button" className="flex-1 truncate text-left" onClick={() => onSelect(c.id)}>
                  <span className={hidden ? "text-dim line-through" : ""}>{c.name}</span>
                </button>
                <span
                  className={`font-mono text-[9px] uppercase ${
                    c.mm20Status === "published" ? "text-mm20" : "text-unknown"
                  }`}
                  title={c.mm20Status === "published" ? "MM20 data published" : "Not publicly specified"}
                >
                  {c.mm20Status === "published" ? "mm20" : "n/p/s"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
