import type { Confidence, EvidenceType, MM20Status, Scope } from "../../types/evidence";

const base =
  "inline-flex items-center rounded-sm border px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap";

function Badge({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span className={`${base} ${className}`} title={title}>
      {children}
    </span>
  );
}

const SCOPE: Record<Scope, { label: string; cls: string; title: string }> = {
  mm20_specific: { label: "MM20-specific", cls: "text-mm20 border-mm20 bg-mm20/10", title: "Value published for the MM20" },
  generic_mems: { label: "Generic MEMS", cls: "text-generic border-generic bg-generic/10", title: "General MEMS engineering knowledge" },
  conceptual: { label: "Conceptual", cls: "text-concept border-concept bg-concept/10", title: "Educational model — not MM20 data" },
  derived: { label: "Derived", cls: "text-concept border-concept bg-concept/10", title: "Computed by this application" },
};

const EVIDENCE: Record<EvidenceType, string> = {
  manufacturer_published: "Manufacturer-published",
  peer_reviewed: "Peer-reviewed",
  established_theory: "Established theory",
  derived: "Derived model",
  conceptual: "Conceptual",
  assumption: "Assumption",
};

const CONF: Record<Confidence, string> = {
  very_high: "Very high confidence",
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function ScopeBadge({ scope }: { scope: Scope }) {
  const s = SCOPE[scope];
  return (
    <Badge className={s.cls} title={s.title}>
      {s.label}
    </Badge>
  );
}

export function EvidenceBadge({ type }: { type: EvidenceType }) {
  const cls =
    type === "manufacturer_published"
      ? "text-mm20 border-mm20"
      : type === "established_theory" || type === "peer_reviewed"
        ? "text-generic border-generic"
        : "text-concept border-concept";
  return <Badge className={cls}>{EVIDENCE[type]}</Badge>;
}

export function ConfidenceBadge({ level }: { level: Confidence }) {
  return <Badge className="text-dim border-line">{CONF[level]}</Badge>;
}

export function Mm20StatusBadge({ status }: { status: MM20Status }) {
  if (status === "published") return <Badge className="text-mm20 border-mm20">MM20 data published</Badge>;
  if (status === "not_publicly_specified") {
    return <Badge className="text-unknown border-dashed border-unknown">Not publicly specified</Badge>;
  }
  return null;
}

export function NotValidatedBadge() {
  return (
    <Badge className="text-concept border-concept" title="This model/equation has not been validated against the MM20">
      Not MM20 validated
    </Badge>
  );
}

export function EvidenceBadges(props: {
  scope?: Scope;
  evidenceType?: EvidenceType;
  confidence?: Confidence;
  mm20Status?: MM20Status;
  notValidated?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.scope && <ScopeBadge scope={props.scope} />}
      {props.evidenceType && <EvidenceBadge type={props.evidenceType} />}
      {props.confidence && <ConfidenceBadge level={props.confidence} />}
      {props.mm20Status && <Mm20StatusBadge status={props.mm20Status} />}
      {props.notValidated && <NotValidatedBadge />}
    </div>
  );
}
