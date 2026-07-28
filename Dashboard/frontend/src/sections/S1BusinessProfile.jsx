import { useState } from 'react';
import { CATEGORIES } from '../lib/contract';
import { Field, InlineError } from '../components/Primitives';
import MicButton from '../components/MicButton';
import { api } from '../lib/api';
import SectionCard from './SectionCard';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// What the backend calls a field, and what this section calls it. Only `desc`
// differs, but the map is worth having explicitly -- a silent mismatch here
// looks exactly like the model having failed to hear something.
const VOICE_FIELDS = {
  name: 'name',
  tagline: 'tagline',
  description: 'desc',
  category: 'category',
  city: 'city',
  email: 'email',
  phone: 'phone',
  hours: 'hours',
};

// A logo is stored inline as base64, not uploaded, so it rides along in every
// business list response and in the published manifest -- and base64 inflates a
// file by about a third. A 2 MB photo would put ~2.7 MB into each of those, for
// something rendered at 40 pixels. Cap it where a real logo still fits easily.
const MAX_LOGO_BYTES = 200 * 1024;

export default function S1BusinessProfile({ sections, updateSection, slug }) {
  const p = sections['1'] || {};
  const set = (patch) => updateSection(1, patch);
  const [logoError, setLogoError] = useState('');

  const emailError =
    p.email && !EMAIL_RE.test(p.email) ? 'That does not look like a valid email' : '';
  const websiteError =
    p.website && !/^https?:\/\//.test(p.website) ? 'Include https:// at the start' : '';

  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [heard, setHeard] = useState('');

  /** Fill from one recording, without ever overwriting what they typed.
   *
   * Only blank fields are filled. A merchant who records twice is correcting
   * themselves, not asking us to discard the edits they made in between -- and
   * a spoken word is the least reliable input in the product, so it loses every
   * tie against something they actually typed.
   */
  const onVoice = async (blob, filename) => {
    setVoiceBusy(true);
    setVoiceError('');
    setHeard('');

    const result = await api.voiceOnboard(blob, filename);
    setVoiceBusy(false);

    if (result.error && !result.heard) {
      setVoiceError(result.error);
      return;
    }
    setHeard(result.heard || '');
    if (result.error) setVoiceError(result.error);

    const fields = result.fields || {};
    const patch = {};
    Object.entries(VOICE_FIELDS).forEach(([from, to]) => {
      if (fields[from] && !String(p[to] || '').trim()) patch[to] = fields[from];
    });
    // Deliberately neither immediate nor slug-committing. Committing the slug
    // re-keys the business, and section 4 below is saved under its own timer --
    // an immediate commit here renames the business out from under that request
    // and it 404s. The slug still adopts the moment the merchant blurs the name
    // field, which is the same path a typed name takes.
    if (Object.keys(patch).length) updateSection(1, patch);

    // Section 4 gets the languages, again only if the merchant hasn't chosen.
    const spoken = fields.languages || [];
    const chosen = sections['4']?.selected || [];
    if (spoken.length && chosen.length === 0) {
      updateSection(4, { selected: spoken, primary: spoken[0] });
    }
  };

  const onLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('That image is over 200 KB. Please use a smaller one.');
      event.target.value = '';
      return;
    }
    setLogoError('');
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
      {/* Speak-to-fill. Deliberately above the form: a merchant who cannot
          complete an English form needs to meet this before the fields, not
          after giving up on them. */}
      <div className="mb-5 rounded-input border border-dashed border-line-dashed p-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium">Fill this in by talking</p>
          <span className="text-xs text-ink-faint">తెలుగు · हिंदी · தமிழ் · and 10 more</span>
        </div>
        <MicButton
          label="Hold to speak"
          busy={voiceBusy}
          onResult={onVoice}
        />
        <p className="mt-2 text-xs text-ink-faint">
          Say your shop’s name, where it is, and what you sell. We only fill blank
          boxes — anything you have already typed stays as it is.
        </p>
        {heard && (
          <p className="mt-2 text-xs text-ink-muted" data-testid="voice-heard">
            <span className="text-ink-faint">Heard:</span> “{heard}”
          </p>
        )}
        <InlineError>{voiceError}</InlineError>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name" required className="sm:col-span-2">
          <input
            className="ucxp-input"
            name="name"
            data-testid="field-name"
            placeholder="e.g. your shop's name"
            value={p.name || ''}
            onChange={(e) => set({ name: e.target.value })}
            onBlur={(e) =>
              // Adopt the slug from the finished name, not from each keystroke.
              updateSection(1, { name: e.target.value }, { immediate: true, commitSlug: true })
            }
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
          {logoError && (
            <span className="text-xs text-err" data-testid="logo-error">{logoError}</span>
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
