import { CATEGORIES } from '../lib/contract';
import { Field } from '../components/Primitives';
import SectionCard from './SectionCard';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function S1BusinessProfile({ sections, updateSection, slug }) {
  const p = sections['1'] || {};
  const set = (patch) => updateSection(1, patch);

  const emailError =
    p.email && !EMAIL_RE.test(p.email) ? 'That does not look like a valid email' : '';
  const websiteError =
    p.website && !/^https?:\/\//.test(p.website) ? 'Include https:// at the start' : '';

  const onLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ logoUrl: String(reader.result || '') });
    reader.readAsDataURL(file);
  };

  return (
    <SectionCard
      testId="section-1"
      title="Business profile"
      subtitle="What customers see when your assistant introduces itself."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name" required className="sm:col-span-2">
          <input
            className="ucxp-input"
            name="name"
            data-testid="field-name"
            placeholder="e.g. Meenakshi Silks"
            value={p.name || ''}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <Field label="Tagline" className="sm:col-span-2">
          <input
            className="ucxp-input"
            name="tagline"
            data-testid="field-tagline"
            placeholder="One line customers remember you by"
            value={p.tagline || ''}
            onChange={(e) => set({ tagline: e.target.value })}
          />
        </Field>

        <Field label="Short description" className="sm:col-span-2">
          <textarea
            className="ucxp-textarea min-h-[74px]"
            rows={3}
            name="desc"
            data-testid="field-desc"
            placeholder="Two sentences about what you sell and who you serve."
            value={p.desc || ''}
            onChange={(e) => set({ desc: e.target.value })}
          />
        </Field>

        <Field label="Category" required>
          <select
            className="ucxp-select"
            name="category"
            data-testid="field-category"
            value={p.category || ''}
            onChange={(e) => set({ category: e.target.value })}
          >
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="City" required>
          <input
            className="ucxp-input"
            name="city"
            data-testid="field-city"
            placeholder="Chennai"
            value={p.city || ''}
            onChange={(e) => set({ city: e.target.value })}
          />
        </Field>

        <Field label="Support email" required error={emailError}>
          <input
            className={`ucxp-input ${emailError ? 'border-err' : ''}`}
            name="email"
            type="email"
            data-testid="field-email"
            placeholder="support@yourbusiness.in"
            value={p.email || ''}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>

        <Field label="Support phone">
          <input
            className="ucxp-input"
            name="phone"
            data-testid="field-phone"
            placeholder="+91 …"
            value={p.phone || ''}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Field>

        <Field label="Website" error={websiteError}>
          <input
            className={`ucxp-input ${websiteError ? 'border-err' : ''}`}
            name="website"
            data-testid="field-website"
            placeholder="https://…"
            value={p.website || ''}
            onChange={(e) => set({ website: e.target.value })}
          />
        </Field>

        <Field label="Business hours">
          <input
            className="ucxp-input"
            name="hours"
            data-testid="field-hours"
            placeholder="Mon–Sat · 10:00–19:00 IST"
            value={p.hours || ''}
            onChange={(e) => set({ hours: e.target.value })}
          />
        </Field>

        {/* logo */}
        <div className="flex flex-wrap items-center gap-3.5 sm:col-span-2">
          {p.logoUrl ? (
            <>
              <div
                role="img"
                aria-label="Business logo"
                data-testid="logo-preview"
                className="h-11 w-11 flex-none rounded-card border border-line bg-cover bg-center"
                style={{ backgroundImage: `url(${p.logoUrl})` }}
              />
              <label className="cursor-pointer text-[13px] font-medium text-ink underline underline-offset-2">
                Replace
                <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
              </label>
              <button
                type="button"
                onClick={() => set({ logoUrl: '' })}
                className="text-[13px] text-ink-muted hover:text-err"
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <label
                className="flex cursor-pointer items-center gap-2.5 rounded-input border
                           border-dashed border-line-dashed px-4 py-3 text-[13px] text-ink-muted
                           transition-colors hover:border-ink hover:text-ink"
                data-testid="logo-dropzone"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-input bg-surface
                             text-[15px] text-ink"
                  aria-hidden="true"
                >
                  ↑
                </span>
                Upload logo
                <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
              </label>
              <span className="text-xs text-ink-faint">PNG or SVG · square works best</span>
            </>
          )}
        </div>

        {/* business_id readout */}
        <div
          className="flex flex-wrap items-center gap-3 rounded-input border border-line
                     bg-surface px-3.5 py-2.5 sm:col-span-2"
        >
          <div className="min-w-[180px] flex-1">
            <div className="mb-0.5 text-[11px] text-ink-muted">business_id</div>
            <div className="font-mono text-[13px]" data-testid="slug-readout">
              {slug}
            </div>
          </div>
          <span className="text-xs text-ink-muted">
            Auto-generated from your business name · not editable
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
