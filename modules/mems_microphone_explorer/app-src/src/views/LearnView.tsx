import { MM20 } from "../data";
import { EvidenceBadges } from "../components/common/Badges";
import { SourceRefs } from "../components/SourcePanel/SourceRefs";
import { LearningChain } from "./Placeholder";

export function LearnView({ onOpen }: { onOpen: (tab: "explorer" | "parameters" | "sources") => void }) {
  return (
    <div className="engineering-grid h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[900px] space-y-5">
        <div className="space-y-2 rounded-sm border border-line bg-panel p-5">
          <div className="label-mono">Interactive engineering textbook + 3D laboratory</div>
          <h1 className="text-[22px] font-semibold">MEMS Microphone Acoustic Explorer</h1>
          <p>
            Follow one chain from physical structure to microphone performance, forwards or backwards, with a traceable source behind every
            fact. The real-world reference is the <strong>{MM20.name}</strong> ({MM20.partNumber}).
          </p>
          <LearningChain />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpen("explorer")}
              className="rounded-sm border border-accent bg-accentsoft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-bg"
            >
              Open 3D explorer
            </button>
            <button
              type="button"
              onClick={() => onOpen("parameters")}
              className="rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider hover:border-accent"
            >
              Browse parameters
            </button>
            <button
              type="button"
              onClick={() => onOpen("sources")}
              className="rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider hover:border-accent"
            >
              Sources &amp; integrity
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 rounded-sm border border-line bg-panel p-4">
            <EvidenceBadges scope="mm20_specific" evidenceType="manufacturer_published" />
            <h3 className="font-semibold">A. MM20 manufacturer-published</h3>
            <p className="text-dim">Values explicitly published by Knowles: sensitivity, noise, supply, package, port, directivity…</p>
          </div>
          <div className="space-y-2 rounded-sm border border-line bg-panel p-4">
            <EvidenceBadges scope="generic_mems" evidenceType="established_theory" />
            <h3 className="font-semibold">B. Generic MEMS knowledge</h3>
            <p className="text-dim">Established principles: stiffness, mass, damping, resonance, acoustic elements, capacitive transduction.</p>
          </div>
          <div className="space-y-2 rounded-sm border border-line bg-panel p-4">
            <EvidenceBadges scope="derived" evidenceType="derived" />
            <h3 className="font-semibold">C. Conceptual / derived</h3>
            <p className="text-dim">Simplified models built for teaching. Never shown as MM20 internals or measurements.</p>
          </div>
        </div>

        <div className="space-y-2 rounded-sm border border-line bg-panel p-4">
          <h3 className="font-semibold">Where the MM20 facts come from</h3>
          <p className="text-dim">{MM20.summary}</p>
          <SourceRefs ids={[MM20.datasheetSourceId]} label="Reference document" />
          <p className="italic text-unknown">
            Anything not in that document is shown as “Not publicly specified” — this application does not guess MM20 internals.
          </p>
        </div>
      </div>
    </div>
  );
}
