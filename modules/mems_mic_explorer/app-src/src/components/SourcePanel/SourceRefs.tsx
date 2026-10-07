import { useState } from "react";
import { SOURCE_BY_ID } from "../../data";
import type { Source } from "../../types/source";

const TYPE_LABEL: Record<Source["sourceType"], string> = {
  manufacturer_datasheet: "Manufacturer datasheet",
  application_note: "Application note",
  academic_paper: "Academic paper",
  textbook: "Textbook",
  technical_reference: "Technical reference",
  derived_model: "Derived model (this app)",
};

function Row({ k, v }: { k: string; v?: React.ReactNode }) {
  if (v === undefined || v === null || v === "") return null;
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-[2px]">
      <span className="label-mono pt-[1px]">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  );
}

export function SourceCard({ source }: { source: Source }) {
  return (
    <div className="rounded-sm border border-line bg-panel2 p-2 text-[12px]">
      <div className="mb-1 font-semibold leading-snug">{source.title}</div>
      <Row k="Type" v={TYPE_LABEL[source.sourceType]} />
      <Row k="Publisher" v={source.publisher} />
      <Row k="Author(s)" v={source.authors?.join(", ")} />
      <Row k="Document" v={source.documentId} />
      <Row k="Revision" v={source.revision} />
      <Row k="Published" v={source.publicationDate} />
      <Row k="Page" v={source.page} />
      <Row k="Section" v={source.section} />
      <Row k="Figure" v={source.figure} />
      <Row k="Table" v={source.table} />
      <Row k="DOI" v={source.doi} />
      <Row k="Notes" v={source.notes} />
      {source.url && (
        <a
          className="mt-1.5 inline-block rounded-sm border border-accent px-2 py-[2px] font-mono text-[11px] text-accent hover:bg-accentsoft"
          href={source.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source ↗
        </a>
      )}
    </div>
  );
}

/** Compact, expandable source citations for any record. Answers: "where did this come from?" */
export function SourceRefs({ ids, label = "Sources" }: { ids: string[]; label?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (ids.length === 0) {
    return <div className="text-[12px] text-concept">No source recorded.</div>;
  }
  return (
    <div>
      <div className="label-mono mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const s = SOURCE_BY_ID.get(id);
          const active = open === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setOpen(active ? null : id)}
              className={`rounded-sm border px-1.5 py-[2px] text-left text-[11px] ${
                active ? "border-accent bg-accentsoft text-accent" : "border-line text-ink hover:border-accent"
              }`}
              title={s?.title ?? id}
            >
              {s ? shortTitle(s) : `⚠ ${id}`}
            </button>
          );
        })}
      </div>
      {open && SOURCE_BY_ID.get(open) && (
        <div className="mt-1.5">
          <SourceCard source={SOURCE_BY_ID.get(open)!} />
        </div>
      )}
    </div>
  );
}

function shortTitle(s: Source): string {
  const loc = [s.table, s.figure, s.page ? `p.${s.page}` : undefined].filter(Boolean).join(" · ");
  const name = s.documentId ?? s.authors?.[0]?.split(" ").slice(-1)[0] ?? s.title;
  return loc ? `${name} — ${loc}` : name.length > 46 ? `${name.slice(0, 44)}…` : name;
}
