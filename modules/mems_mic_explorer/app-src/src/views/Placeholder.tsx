const CHAIN = ["Structure", "Parameter", "Physical mechanism", "Equation", "Response", "Performance"];

export function Placeholder({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <div className="engineering-grid flex h-full items-center justify-center p-6">
      <div className="max-w-[640px] space-y-3 rounded-sm border border-line bg-panel p-6">
        <div className="label-mono">Planned · Phase {phase}</div>
        <h2 className="text-[20px] font-semibold">{title}</h2>
        {children}
        <p className="text-dim">
          The data architecture (sources → parameters → equations → relationships → mechanisms → response → performance) already
          supports this view; it will be built in Phase {phase}.
        </p>
      </div>
    </div>
  );
}

export function LearningChain() {
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] uppercase tracking-wider">
      {CHAIN.map((c, i) => (
        <span key={c} className="flex items-center gap-1">
          <span className="rounded-sm border border-accent bg-accentsoft px-1.5 py-[2px] text-accent">{c}</span>
          {i < CHAIN.length - 1 && <span className="text-dim">→</span>}
        </span>
      ))}
    </div>
  );
}
