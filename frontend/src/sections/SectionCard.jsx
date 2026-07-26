/** The shell every section shares: card, heading, sub-heading, mount animation. */
export default function SectionCard({ title, subtitle, note, children, testId }) {
  return (
    <section
      className="ucxp-rise ucxp-card p-6"
      data-testid={testId}
      aria-labelledby={`${testId}-heading`}
    >
      <header className="mb-5">
        <h2 id={`${testId}-heading`} className="mb-1 text-base font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
        {note && <p className="mt-1.5 text-xs text-ink-faint">{note}</p>}
      </header>
      {children}
    </section>
  );
}
