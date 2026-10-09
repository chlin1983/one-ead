export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="label-mono border-b border-line pb-0.5">{title}</h3>
      {children}
    </section>
  );
}
