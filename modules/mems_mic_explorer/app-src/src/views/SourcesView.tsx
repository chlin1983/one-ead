import { useMemo } from "react";
import { COMPONENTS, EQUATIONS, PARAMETERS, RELATIONSHIPS, SOURCES } from "../data";
import { validateKnowledge } from "../knowledge/validate";
import { SourceCard } from "../components/SourcePanel/SourceRefs";
import { EvidenceBadges } from "../components/common/Badges";
import { Section } from "../components/common/Section";

export function SourcesView() {
  const issues = useMemo(() => validateKnowledge(), []);
  const errors = issues.filter((i) => i.severity === "error");

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-[980px] space-y-6">
        <Section title="Evidence legend">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 rounded-sm border border-line bg-panel p-3">
              <EvidenceBadges scope="mm20_specific" evidenceType="manufacturer_published" confidence="very_high" mm20Status="published" />
              <p className="text-dim">Value published by Knowles for the MM20, traceable to a datasheet table/figure/page.</p>
            </div>
            <div className="space-y-1 rounded-sm border border-line bg-panel p-3">
              <EvidenceBadges scope="generic_mems" evidenceType="established_theory" confidence="high" mm20Status="not_publicly_specified" />
              <p className="text-dim">General MEMS/acoustics theory. Shown without a value; the MM20 value is not documented.</p>
            </div>
            <div className="space-y-1 rounded-sm border border-line bg-panel p-3">
              <EvidenceBadges scope="derived" evidenceType="derived" notValidated />
              <p className="text-dim">Computed or illustrative by this application. Never presented as MM20 data.</p>
            </div>
          </div>
        </Section>

        <Section title="Data integrity (checked at build and on this page)">
          <div className="rounded-sm border border-line bg-panel p-3">
            <div className="font-mono text-[12px]">
              {SOURCES.length} sources · {PARAMETERS.length} parameters · {EQUATIONS.length} equations · {RELATIONSHIPS.length}{" "}
              relationships · {COMPONENTS.length} structure components
            </div>
            <div className={`mt-1 font-semibold ${errors.length ? "text-concept" : "text-accent"}`}>
              {errors.length === 0 ? "All traceability rules pass." : `${errors.length} rule violation(s):`}
            </div>
            {issues.length > 0 && (
              <ul className="mt-1 list-disc pl-5 font-mono text-[11px]">
                {issues.map((i, n) => (
                  <li key={n} className={i.severity === "error" ? "text-concept" : "text-dim"}>
                    [{i.rule}] {i.record}: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title={`Source library (${SOURCES.length})`}>
          <div className="grid gap-3 md:grid-cols-2">
            {SOURCES.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
