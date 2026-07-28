import { useState } from 'react';
import { CAPABILITY_BY_KEY, HTTP_METHODS, buildCurl, isValidJson } from '../lib/contract';
import { copyText } from '../lib/api';
import { useToast } from './Primitives';

const TABS = ['Overview', 'Parameters', 'Request', 'Response', 'Errors', 'Test'];

/** Valid-JSON indicator used by the Request and Response tabs. */
function JsonChip({ text }) {
  const state = isValidJson(text);
  const styles =
    state === null
      ? 'bg-surface-deep text-ink-muted'
      : state
        ? 'bg-ok-tint text-ok'
        : 'bg-err-tint text-err';
  const label =
    state === null ? 'Empty — add an example' : state ? '✓ Valid JSON' : '✗ Invalid JSON';
  return (
    <span className={`ucxp-pill ${styles}`} data-testid="json-chip" data-valid={String(state)}>
      {label}
    </span>
  );
}

function TableShell({ columns, children, onAdd, addLabel, locked }) {
  return (
    <div className="overflow-hidden rounded-input border border-line">
      <div
        className="grid bg-surface"
        style={{ gridTemplateColumns: columns.map((c) => c.width).join(' ') }}
      >
        {columns.map((column) => (
          <div
            key={column.label}
            className="px-2.5 py-[7px] text-[10.5px] font-semibold uppercase tracking-[0.05em]
                       text-ink-muted"
          >
            {column.label}
          </div>
        ))}
      </div>
      {children}
      {!locked && (
        <button
          type="button"
          onClick={onAdd}
          className="block w-full px-2.5 py-2 text-left text-[12.5px] text-ink underline
                     underline-offset-2 hover:bg-surface"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

/** Full capability contract editor.
 *
 * `locked` is ONLY ever true for a Shopify-seeded contract the merchant has not
 * customised yet, and "Customize" clears it. On the Custom REST and No-data-source
 * paths every contract arrives with locked:false, so every field below is
 * editable from the first render — nothing here is permanently read-only.
 */
export default function ContractEditor({ contract, onChange, onCustomize, onReset, baseUrl }) {
  const [tab, setTab] = useState('Overview');
  const toast = useToast();
  const locked = Boolean(contract.locked);
  const cap = CAPABILITY_BY_KEY[contract.name] || {};

  const patch = (changes) => onChange({ ...contract, ...changes });
  const patchDeep = (key, changes) => patch({ [key]: { ...contract[key], ...changes } });

  const inputCls = `ucxp-input ${locked ? 'bg-surface' : ''}`;
  const cellCls = 'w-full border-none bg-transparent px-2.5 py-2 text-[12.5px] outline-none';

  const updateList = (group, listKey, index, changes) => {
    const list = [...((contract[group] || {})[listKey] || [])];
    list[index] = { ...list[index], ...changes };
    patchDeep(group, { [listKey]: list });
  };
  const removeFromList = (group, listKey, index) => {
    const list = [...((contract[group] || {})[listKey] || [])];
    list.splice(index, 1);
    patchDeep(group, { [listKey]: list });
  };

  return (
    <div className="flex flex-col gap-3.5 border-t border-line-soft p-4" data-testid={`contract-${contract.name}`}>
      {locked && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-input border border-line
                        bg-surface px-3 py-2.5">
          <span className="min-w-[200px] flex-1 text-[12.5px] text-ink-muted">
            Contract pre-filled by the Shopify connector and kept in sync.
          </span>
          <button
            type="button"
            data-testid={`customize-${contract.name}`}
            onClick={onCustomize}
            className="ucxp-press rounded-btn border border-line bg-canvas px-3 py-1.5
                       text-[12.5px] font-medium hover:bg-surface"
          >
            Customize
          </button>
        </div>
      )}

      {!locked && contract.auto && (
        <div className="rounded-input border border-line bg-surface px-3 py-2.5">
          <span className="text-[12.5px] text-ink-muted">
            Customized — your edits override the Shopify connector.{' '}
          </span>
          <button
            type="button"
            data-testid={`reset-${contract.name}`}
            onClick={onReset}
            className="text-[12.5px] text-ink underline underline-offset-2"
          >
            Reset to Shopify defaults
          </button>
        </div>
      )}

      {/* tabs */}
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line-soft">
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            data-testid={`tab-${contract.name}-${name.toLowerCase()}`}
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors
                        ${tab === name
                          ? 'border-ink text-ink'
                          : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* ---------------- Overview ---------------- */}
      {tab === 'Overview' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="ucxp-label">Endpoint path</label>
              <input
                className={`${inputCls} font-mono text-[13px]`}
                data-testid={`endpoint-${contract.name}`}
                readOnly={locked}
                placeholder={cap.defaultPath}
                value={contract.endpoint || ''}
                onChange={(e) => patch({ endpoint: e.target.value })}
              />
            </div>
            <div className="w-[120px]">
              <label className="ucxp-label">Method</label>
              <select
                className={`ucxp-select font-mono ${locked ? 'bg-surface' : ''}`}
                data-testid={`method-${contract.name}`}
                disabled={locked}
                value={contract.method || 'GET'}
                onChange={(e) => patch({ method: e.target.value })}
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="ucxp-label">Description</label>
            <textarea
              className={`ucxp-textarea ${locked ? 'bg-surface' : ''}`}
              rows={2}
              data-testid={`description-${contract.name}`}
              readOnly={locked}
              placeholder="What this capability does, in one line."
              value={contract.description || ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
          <div>
            <label className="ucxp-label">Notes for the runtime</label>
            <textarea
              className={`ucxp-textarea ${locked ? 'bg-surface' : ''}`}
              rows={2}
              data-testid={`notes-${contract.name}`}
              readOnly={locked}
              placeholder="Anything the assistant should know — rate limits, id formats, quirks."
              value={contract.notes || ''}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* ---------------- Parameters ---------------- */}
      {tab === 'Parameters' && (
        <div className="flex flex-col gap-4">
          {['path', 'query'].map((group) => (
            <div key={group}>
              <label className="ucxp-label capitalize">{group} parameters</label>
              <TableShell
                locked={locked}
                addLabel={`+ Add ${group} parameter`}
                onAdd={() =>
                  patchDeep('parameters', {
                    [group]: [
                      ...(contract.parameters?.[group] || []),
                      { name: '', type: 'string', required: false, example: '', description: '' },
                    ],
                  })
                }
                columns={[
                  { label: 'Name', width: '1fr' },
                  { label: 'Type', width: '96px' },
                  { label: 'Required', width: '80px' },
                  { label: 'Example', width: '1fr' },
                  { label: 'Description', width: '1.4fr' },
                  { label: '', width: '36px' },
                ]}
              >
                {(contract.parameters?.[group] || []).length === 0 ? (
                  <p className="px-2.5 py-3 text-[12.5px] text-ink-muted">
                    No {group} parameters yet.
                  </p>
                ) : (
                  (contract.parameters?.[group] || []).map((param, index) => (
                    <div
                      key={index}
                      className="grid items-center border-b border-line-soft"
                      style={{ gridTemplateColumns: '1fr 96px 80px 1fr 1.4fr 36px' }}
                    >
                      <input
                        className={`${cellCls} font-mono`}
                        readOnly={locked}
                        placeholder="order_id"
                        value={param.name || ''}
                        data-testid={`param-${contract.name}-${group}-${index}-name`}
                        onChange={(e) => updateList('parameters', group, index, { name: e.target.value })}
                      />
                      <select
                        className={`${cellCls} border-l border-line-soft`}
                        disabled={locked}
                        value={param.type || 'string'}
                        onChange={(e) => updateList('parameters', group, index, { type: e.target.value })}
                      >
                        {['string', 'integer', 'number', 'boolean'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <label className="flex justify-center border-l border-line-soft py-2">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={Boolean(param.required)}
                          aria-label="Required"
                          onChange={(e) =>
                            updateList('parameters', group, index, { required: e.target.checked })}
                        />
                      </label>
                      <input
                        className={`${cellCls} border-l border-line-soft`}
                        readOnly={locked}
                        placeholder="1001"
                        value={param.example || ''}
                        onChange={(e) => updateList('parameters', group, index, { example: e.target.value })}
                      />
                      <input
                        className={`${cellCls} border-l border-line-soft`}
                        readOnly={locked}
                        placeholder="What this value is"
                        value={param.description || ''}
                        onChange={(e) =>
                          updateList('parameters', group, index, { description: e.target.value })}
                      />
                      <button
                        type="button"
                        title="Remove row"
                        disabled={locked}
                        onClick={() => removeFromList('parameters', group, index)}
                        className="px-0 py-2 text-xs text-ink-faint hover:text-err disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </TableShell>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Request ---------------- */}
      {tab === 'Request' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="ucxp-label">Headers</label>
            <TableShell
              locked={locked}
              addLabel="+ Add header"
              onAdd={() =>
                patchDeep('request', {
                  headers: [...(contract.request?.headers || []), { name: '', value: '' }],
                })
              }
              columns={[
                { label: 'Header', width: '1fr' },
                { label: 'Value', width: '1.4fr' },
                { label: '', width: '36px' },
              ]}
            >
              {(contract.request?.headers || []).length === 0 ? (
                <p className="px-2.5 py-3 text-[12.5px] text-ink-muted">No headers yet.</p>
              ) : (
                (contract.request?.headers || []).map((header, index) => (
                  <div
                    key={index}
                    className="grid items-center border-b border-line-soft"
                    style={{ gridTemplateColumns: '1fr 1.4fr 36px' }}
                  >
                    <input
                      className={`${cellCls} font-mono`}
                      readOnly={locked}
                      placeholder="X-API-Key"
                      value={header.name || ''}
                      data-testid={`header-${contract.name}-${index}-name`}
                      onChange={(e) => updateList('request', 'headers', index, { name: e.target.value })}
                    />
                    <input
                      className={`${cellCls} border-l border-line-soft font-mono`}
                      readOnly={locked}
                      placeholder="{{credential_ref}}"
                      value={header.value || ''}
                      onChange={(e) => updateList('request', 'headers', index, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      title="Remove row"
                      disabled={locked}
                      onClick={() => removeFromList('request', 'headers', index)}
                      className="px-0 py-2 text-xs text-ink-faint hover:text-err disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </TableShell>
            <p className="mt-1.5 text-xs text-ink-faint">
              Use <span className="font-mono">{'{{credential_ref}}'}</span> where the secret goes —
              Sahayak swaps in the vaulted value at runtime.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="ucxp-label mb-0">Request body</label>
              <JsonChip text={contract.request?.body} />
            </div>
            <textarea
              className={`ucxp-textarea font-mono text-[12.5px] leading-relaxed
                          ${locked ? 'bg-surface' : ''}`}
              rows={6}
              spellCheck={false}
              readOnly={locked}
              data-testid={`request-body-${contract.name}`}
              placeholder={cap.defaultRequest}
              value={contract.request?.body || ''}
              onChange={(e) => patchDeep('request', { body: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* ---------------- Response ---------------- */}
      {tab === 'Response' && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="ucxp-label mb-0">Response example</label>
              <JsonChip text={contract.response?.sample} />
            </div>
            <textarea
              className={`ucxp-textarea font-mono text-[12.5px] leading-relaxed
                          ${locked ? 'bg-surface' : ''}`}
              rows={6}
              spellCheck={false}
              readOnly={locked}
              data-testid={`response-sample-${contract.name}`}
              placeholder={cap.defaultResponse}
              value={contract.response?.sample || ''}
              onChange={(e) => patchDeep('response', { sample: e.target.value })}
            />
          </div>

          <div>
            <label className="ucxp-label">Field mapping</label>
            <TableShell
              locked={locked}
              addLabel="+ Add mapping"
              onAdd={() =>
                patchDeep('response', {
                  mapping: [...(contract.response?.mapping || []), { field: '', path: '' }],
                })
              }
              columns={[
                { label: 'Field the assistant uses', width: '1fr' },
                { label: 'Path in your response', width: '1.4fr' },
                { label: '', width: '36px' },
              ]}
            >
              {(contract.response?.mapping || []).length === 0 ? (
                <p className="px-2.5 py-3 text-[12.5px] text-ink-muted">No mappings yet.</p>
              ) : (
                (contract.response?.mapping || []).map((row, index) => (
                  <div
                    key={index}
                    className="grid items-center border-b border-line-soft"
                    style={{ gridTemplateColumns: '1fr 1.4fr 36px' }}
                  >
                    <input
                      className={`${cellCls} font-mono`}
                      readOnly={locked}
                      placeholder="status"
                      value={row.field || ''}
                      data-testid={`mapping-${contract.name}-${index}-field`}
                      onChange={(e) => updateList('response', 'mapping', index, { field: e.target.value })}
                    />
                    <input
                      className={`${cellCls} border-l border-line-soft font-mono`}
                      readOnly={locked}
                      placeholder="$.data.status"
                      value={row.path || ''}
                      onChange={(e) => updateList('response', 'mapping', index, { path: e.target.value })}
                    />
                    <button
                      type="button"
                      title="Remove row"
                      disabled={locked}
                      onClick={() => removeFromList('response', 'mapping', index)}
                      className="px-0 py-2 text-xs text-ink-faint hover:text-err disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </TableShell>
          </div>
        </div>
      )}

      {/* ---------------- Errors ---------------- */}
      {tab === 'Errors' && (
        <div>
          <label className="ucxp-label">Error codes</label>
          <TableShell
            locked={locked}
            addLabel="+ Add error code"
            onAdd={() =>
              patch({
                errors: [...(contract.errors || []), { code: '', meaning: '', customer_message: '' }],
              })
            }
            columns={[
              { label: 'Code', width: '76px' },
              { label: 'Meaning', width: '1fr' },
              { label: 'Customer message', width: '1.4fr' },
              { label: '', width: '36px' },
            ]}
          >
            {(contract.errors || []).length === 0 ? (
              <p className="px-2.5 py-3 text-[12.5px] text-ink-muted">
                No error codes yet — add the ones your API returns.
              </p>
            ) : (
              (contract.errors || []).map((row, index) => (
                <div
                  key={index}
                  className="grid items-center border-b border-line-soft"
                  style={{ gridTemplateColumns: '76px 1fr 1.4fr 36px' }}
                >
                  <input
                    className={`${cellCls} font-mono`}
                    readOnly={locked}
                    placeholder="404"
                    value={row.code || ''}
                    data-testid={`error-${contract.name}-${index}-code`}
                    onChange={(e) => {
                      const errors = [...(contract.errors || [])];
                      errors[index] = { ...errors[index], code: e.target.value };
                      patch({ errors });
                    }}
                  />
                  <input
                    className={`${cellCls} border-l border-line-soft`}
                    readOnly={locked}
                    placeholder="Order not found"
                    value={row.meaning || ''}
                    onChange={(e) => {
                      const errors = [...(contract.errors || [])];
                      errors[index] = { ...errors[index], meaning: e.target.value };
                      patch({ errors });
                    }}
                  />
                  <input
                    className={`${cellCls} border-l border-line-soft`}
                    readOnly={locked}
                    placeholder="Sorry, we couldn't find that order number"
                    value={row.customer_message || ''}
                    onChange={(e) => {
                      const errors = [...(contract.errors || [])];
                      errors[index] = { ...errors[index], customer_message: e.target.value };
                      patch({ errors });
                    }}
                  />
                  <button
                    type="button"
                    title="Remove row"
                    disabled={locked}
                    onClick={() => {
                      const errors = [...(contract.errors || [])];
                      errors.splice(index, 1);
                      patch({ errors });
                    }}
                    className="px-0 py-2 text-xs text-ink-faint hover:text-err disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </TableShell>
        </div>
      )}

      {/* ---------------- Test ---------------- */}
      {tab === 'Test' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <label className="ucxp-label mb-0">Generated request</label>
            <button
              type="button"
              data-testid={`copy-curl-${contract.name}`}
              onClick={async () => {
                const ok = await copyText(buildCurl(contract, baseUrl));
                toast(ok ? 'Copied to clipboard' : 'Could not copy — select the text manually');
              }}
              className="ucxp-press rounded-btn border border-line bg-canvas px-3 py-1.5
                         text-[12.5px] font-medium hover:bg-surface"
            >
              Copy cURL
            </button>
          </div>
          <pre
            className="ucxp-pane-scroll overflow-x-auto rounded-input bg-pane-bg px-3.5 py-3
                       font-mono text-[11.5px] leading-relaxed text-pane-text"
            data-testid={`curl-${contract.name}`}
          >
            {buildCurl(contract, baseUrl)}
          </pre>
          <p className="text-xs text-ink-faint">
            This is the exact call Sahayak will make. The secret is substituted from the vault at
            runtime — it is never shown here.
          </p>
        </div>
      )}
    </div>
  );
}
