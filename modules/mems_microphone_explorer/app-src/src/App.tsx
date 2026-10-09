import { useEffect, useState } from "react";
import { Explorer3D } from "./components/Microphone3D/Explorer3D";
import { LearnView } from "./views/LearnView";
import { ParametersView } from "./views/ParametersView";
import { Placeholder } from "./views/Placeholder";
import { SourcesView } from "./views/SourcesView";

type Tab = "learn" | "explorer" | "response" | "parameters" | "physics" | "experiments" | "sources";

const TABS: { id: Tab; label: string }[] = [
  { id: "learn", label: "Learn" },
  { id: "explorer", label: "3D Explorer" },
  { id: "response", label: "Response" },
  { id: "parameters", label: "Parameters" },
  { id: "physics", label: "Physics" },
  { id: "experiments", label: "Experiments" },
  { id: "sources", label: "Sources" },
];

const THEME_KEY = "mems-explorer:theme";

export function App() {
  const [tab, setTab] = useState<Tab>("explorer");
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-4 py-2">
        <div className="font-mono text-[12px] font-bold uppercase tracking-[0.14em]">MEMS Microphone Acoustic Explorer</div>
        <nav className="flex flex-1 items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-sm border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
                tab === t.id ? "border-accent bg-accentsoft text-accent" : "border-transparent text-dim hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setDark(!dark)}
          className="rounded-sm border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-dim hover:border-accent hover:text-accent"
        >
          {dark ? "Light" : "Dark"}
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {tab === "learn" && <LearnView onOpen={(t) => setTab(t)} />}
        {tab === "explorer" && <Explorer3D dark={dark} />}
        {tab === "response" && (
          <Placeholder title="MM20 frequency response" phase={2}>
            <p>
              Will show the manufacturer typical response (datasheet Figure 1, with source page and extraction method recorded)
              and a separate conceptual physics curve — never merged.
            </p>
          </Placeholder>
        )}
        {tab === "parameters" && <ParametersView />}
        {tab === "physics" && (
          <Placeholder title="Physics laboratory" phase={4}>
            <p>Conceptual mass–spring–damper and simplified acoustic lumped model — labelled “Conceptual Physics Model — Not MM20 Measurement”.</p>
          </Placeholder>
        )}
        {tab === "experiments" && (
          <Placeholder title="Experiments" phase={4}>
            <p>Change stiffness, mass, damping, port resistance, cavity compliance or diaphragm area and see the causal chain.</p>
          </Placeholder>
        )}
        {tab === "sources" && <SourcesView />}
      </div>
    </div>
  );
}
