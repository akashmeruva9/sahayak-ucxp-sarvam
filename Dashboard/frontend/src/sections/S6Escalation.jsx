import { Toggle } from '../components/Primitives';
import SectionCard from './SectionCard';

const digits = (value) => (value || '').replace(/\D/g, '').slice(0, 3);

export default function S6Escalation({ sections, updateSection }) {
  const e = sections['6'] || {};
  const set = (patch) => updateSection(6, patch);
  const fr = e.fr ?? '48';
  const res = e.res ?? '30';

  return (
    <SectionCard
      testId="section-6"
      title="Escalation & SLA"
      subtitle="Promises the assistant makes on your behalf — and the ladder it climbs when things stall."
    >
      <div className="mb-6 flex flex-wrap gap-7">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="sla-first">First response within</label>
          <input
            id="sla-first"
            inputMode="numeric"
            data-testid="sla-first-response"
            className="ucxp-input w-[60px] px-0 py-2 text-center font-mono"
            value={fr}
            onChange={(event) => set({ fr: digits(event.target.value) })}
          />
          <span>hours</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="sla-res">Resolution within</label>
          <input
            id="sla-res"
            inputMode="numeric"
            data-testid="sla-resolution"
            className="ucxp-input w-[60px] px-0 py-2 text-center font-mono"
            value={res}
            onChange={(event) => set({ res: digits(event.target.value) })}
          />
          <span>days</span>
        </div>
      </div>

      <label className="ucxp-label mb-2.5 block">Escalation ladder</label>
      <div className="mb-5 flex flex-col" data-testid="escalation-ladder">
        {/* rung 1 */}
        <div className="flex gap-3.5 border-b border-line-soft py-3">
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center
                           rounded-full bg-surface text-xs font-semibold">1</span>
          <div className="flex-1">
            <div className="text-[13.5px] font-medium">Support agent</div>
            <div className="mt-px text-xs text-ink-muted">
              The assistant plus your inbox — handles everything first.
            </div>
          </div>
          <span className="self-center text-xs text-ink-muted">Immediately</span>
        </div>

        {/* rung 2 */}
        <div className="flex gap-3.5 border-b border-line-soft py-3">
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center
                           rounded-full bg-surface text-xs font-semibold">2</span>
          <div className="flex-1">
            <div className="mb-2 text-[13.5px] font-medium">Grievance officer</div>
            <div className="flex flex-wrap gap-2">
              <input
                className="ucxp-input min-w-[140px] flex-1 px-2.5 py-2 text-[13px]"
                data-testid="grievance-name"
                placeholder="Full name"
                value={e.gName || ''}
                onChange={(event) => set({ gName: event.target.value })}
              />
              <input
                className="ucxp-input min-w-[180px] flex-[1.4] px-2.5 py-2 text-[13px]"
                data-testid="grievance-email"
                placeholder="grievance@yourbusiness.in"
                value={e.gEmail || ''}
                onChange={(event) => set({ gEmail: event.target.value })}
              />
            </div>
          </div>
          <span className="self-center whitespace-nowrap text-xs text-ink-muted">
            After {fr || 48} hours
          </span>
        </div>

        {/* rung 3 */}
        <div className="flex gap-3.5 py-3">
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center
                           rounded-full bg-surface text-xs font-semibold">3</span>
          <div className="flex-1">
            <div className="text-[13.5px] font-medium">National Consumer Helpline</div>
            <div className="mt-0.5 font-mono text-xs text-ink-muted">
              1915 · consumerhelpline.gov.in
            </div>
          </div>
          <span className="self-center whitespace-nowrap text-xs text-ink-muted">
            After {res || 30} days
          </span>
        </div>
      </div>

      <div className="mb-3.5 flex items-center gap-3 rounded-input border border-line px-3.5 py-3">
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">Auto-escalate on SLA breach</div>
          <div className="mt-px text-xs text-ink-muted">
            Tickets climb the ladder automatically when a timer lapses.
          </div>
        </div>
        <Toggle
          checked={e.auto !== false}
          onChange={(value) => set({ auto: value })}
          label="Auto-escalate on SLA breach"
        />
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        Aligned with the Consumer Protection (E-Commerce) Rules, 2020 — grievances acknowledged
        within 48 hours and resolved within one month of receipt.
      </p>
    </SectionCard>
  );
}
