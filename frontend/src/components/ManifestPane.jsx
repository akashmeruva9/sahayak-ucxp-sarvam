import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, downloadJson } from '../lib/api';
import { Spinner, useToast } from './Primitives';

/** Tokenise a JSON line for syntax colouring. Mirrors the design's tokenizer. */
const TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b|([{}[\],])/g;

function tokenize(line) {
  const spans = [];
  let cursor = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > cursor) {
      spans.push({ text: line.slice(cursor, match.index), cls: 'text-pane-dim' });
    }
    const [full, str, colon, num, bool, punct] = match;
    if (str !== undefined) {
      // A quoted string followed by a colon is a key.
      spans.push({ text: str, cls: colon ? 'text-code-key' : 'text-code-string' });
      if (colon) spans.push({ text: colon, cls: 'text-code-punct' });
    } else if (num !== undefined) {
      spans.push({ text: num, cls: 'text-code-number' });
    } else if (bool !== undefined) {
      spans.push({ text: bool, cls: 'text-code-bool' });
    } else if (punct !== undefined) {
      spans.push({ text: punct, cls: 'text-code-punct' });
    }
    cursor = match.index + full.length;
  }
  if (cursor < line.length) spans.push({ text: line.slice(cursor), cls: 'text-pane-dim' });
  if (spans.length === 0) spans.push({ text: ' ', cls: 'text-pane-dim' });
  return spans;
}

/** The sticky dark editor pane showing support.manifest.json as it is built.
 *
 * `text` here is the exact string Download writes, so the two can never differ.
 */
export default function ManifestPane({
  manifest,
  status = 'draft',
  version = 0,
  sticky = true,
  maxHeight = 'calc(100vh - 210px)',
  readOnly = false,
  loading = false,
}) {
  const toast = useToast();
  const text = useMemo(
    () => (manifest ? JSON.stringify(manifest, null, 2) : ''),
    [manifest],
  );
  const lines = useMemo(() => (text ? text.split('\n') : []), [text]);

  // Flash the lines that changed since the last render, then fade them out.
  const previous = useRef([]);
  const [changed, setChanged] = useState(new Set());
  useEffect(() => {
    const before = previous.current;
    const next = new Set();
    lines.forEach((line, index) => {
      if (before[index] !== line) next.add(index);
    });
    previous.current = lines;
    if (before.length === 0 || next.size === 0) return undefined;
    setChanged(next);
    const timer = setTimeout(() => setChanged(new Set()), 850);
    return () => clearTimeout(timer);
  }, [lines]);

  const active = status === 'active';

  return (
    <aside
      className={`${sticky ? 'lg:sticky lg:top-[76px]' : ''} min-w-0`}
      data-testid="manifest-pane"
    >
      <div className="flex flex-col overflow-hidden rounded-card border border-pane-border bg-pane-bg">
        {/* file tab */}
        <div className="flex items-center gap-2.5 border-b border-pane-border bg-pane-bar px-3 py-2.5">
          <span
            className={`h-2 w-2 flex-none rounded-full ${active ? 'bg-ok' : 'bg-warn'}`}
            aria-hidden="true"
          />
          <span className="whitespace-nowrap font-mono text-xs text-pane-text">
            support.manifest.json
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-pane-dim">
            {readOnly
              ? `${lines.length} lines · read-only`
              : active
                ? `Published · v${version || 1} · just now`
                : 'Draft — unpublished'}
          </span>
          {loading && <Spinner light size={11} />}
          {!readOnly && (
            <>
              <button
                type="button"
                data-testid="pane-copy"
                onClick={async () => {
                  const ok = await copyText(text);
                  toast(ok ? 'Copied to clipboard' : 'Could not copy — select and copy manually');
                }}
                disabled={!text}
                className="ucxp-press flex-none rounded-btn border border-pane-border px-2.5
                           py-1 text-xs text-pane-text transition-colors hover:bg-pane-hover
                           disabled:opacity-40"
              >
                Copy
              </button>
              <button
                type="button"
                data-testid="pane-download"
                onClick={() => {
                  downloadJson('support.manifest.json', text);
                  toast('support.manifest.json downloaded');
                }}
                disabled={!text}
                className="ucxp-press flex-none rounded-btn border border-pane-border px-2.5
                           py-1 text-xs text-pane-text transition-colors hover:bg-pane-hover
                           disabled:opacity-40"
              >
                Download
              </button>
            </>
          )}
        </div>

        {/* code */}
        <div
          className="ucxp-pane-scroll overflow-auto py-3 font-mono"
          style={{ maxHeight }}
          data-testid="manifest-code"
        >
          {lines.length === 0 ? (
            <p className="px-4 text-xs text-pane-dim">
              Your manifest appears here as you fill in the sections.
            </p>
          ) : (
            lines.map((line, index) => (
              <div
                key={index}
                className="ucxp-json-line flex"
                data-changed={changed.has(index) ? 'true' : 'false'}
              >
                <span
                  className="w-[42px] flex-none select-none pr-3 text-right text-[11.5px]
                             leading-[1.75] text-pane-gutter"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="whitespace-pre pr-4 text-[12.5px] leading-[1.75]">
                  {tokenize(line).map((span, i) => (
                    <span key={i} className={span.cls}>
                      {span.text}
                    </span>
                  ))}
                </span>
              </div>
            ))
          )}
        </div>

        {!readOnly && (
          <div className="border-t border-pane-border px-3.5 py-2 font-mono text-[11px] text-pane-dim">
            {lines.length} lines · schema v1 · updates live as you type
          </div>
        )}
      </div>
    </aside>
  );
}
