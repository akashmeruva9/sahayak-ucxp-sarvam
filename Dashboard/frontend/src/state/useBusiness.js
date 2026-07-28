import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const AUTOSAVE_MS = 600;

/** Loads one business, autosaves section edits, and keeps the manifest in step.
 *
 * The live JSON preview is whatever GET /api/business/{id}/manifest returned --
 * it is never assembled a second time in the browser. That is what makes the
 * preview and the downloaded file byte-identical (gate F6).
 */
export function useBusiness(businessId, onRename) {
  const [business, setBusiness] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [completion, setCompletion] = useState(0);
  const [missing, setMissing] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  // True from the moment an edit is queued until every queued section has landed.
  // The visible label says "All changes saved" in both the idle and saved states,
  // so this is the only honest signal that there is nothing outstanding.
  const [dirty, setDirty] = useState(false);

  const timers = useRef({});
  const pending = useRef({});
  // Every edit to a section cancels that section's pending timer, so an intent
  // carried on the timer's closure is lost the moment the next keystroke lands.
  // Slug adoption is exactly that kind of intent -- it is raised once, on the
  // name field's blur, and must survive until a save actually carries it.
  const slugCommit = useRef({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  const refreshManifest = useCallback(async (id) => {
    const result = await api.getManifest(id);
    if (!alive.current) return;
    if (result.error) return; // keep the last good preview rather than blanking it
    setManifest(result.manifest);
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const result = await api.getBusiness(businessId);
    if (!alive.current) return;
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setError('');
    setBusiness(result.business);
    setStatuses(result.statuses || {});
    setCompletion(result.completion || 0);
    setMissing(result.missing || []);
    setLoading(false);
    refreshManifest(businessId);
  }, [businessId, refreshManifest]);

  useEffect(() => {
    load();
  }, [load]);

  /** Merge a patch into a section locally, then debounce the save. */
  const updateSection = useCallback(
    (section, patch, { immediate = false, commitSlug = false } = {}) => {
      const key = String(section);
      setDirty(true);
      setBusiness((previous) => {
        if (!previous) return previous;
        const current = previous.sections[key] || {};
        const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
        pending.current[key] = next;
        return {
          ...previous,
          sections: { ...previous.sections, [key]: next },
        };
      });

      if (commitSlug) slugCommit.current[key] = true;

      clearTimeout(timers.current[key]);
      const flush = async () => {
        const data = pending.current[key];
        if (data === undefined) return;
        const wantsSlug = slugCommit.current[key] === true;
        setSaveState('saving');
        const result = await api.saveSection(businessId, key, data, wantsSlug);
        if (!alive.current) return;
        if (result.error) {
          setSaveState('error');
          setError(result.error);
          return;
        }
        setError('');
        setStatuses(result.statuses || {});
        setCompletion(result.completion || 0);
        setMissing(result.missing || []);
        setSaveState('saved');
        if (wantsSlug) delete slugCommit.current[key];
        // Only retire the payload we actually sent; an edit queued while the
        // request was in flight is still outstanding and must not be dropped.
        if (pending.current[key] === data) delete pending.current[key];
        if (Object.keys(pending.current).length === 0) setDirty(false);
        // Naming a draft adopts the real slug, which re-keys the business.
        if (result.business_id && result.business_id !== businessId) {
          onRename?.(result.business_id);
          return;
        }
        refreshManifest(businessId);
      };
      timers.current[key] = setTimeout(flush, immediate ? 0 : AUTOSAVE_MS);
    },
    [businessId, refreshManifest, onRename],
  );

  /** Force any queued edits to land now — used before activating. */
  const flushAll = useCallback(async () => {
    const keys = Object.keys(pending.current);
    Object.values(timers.current).forEach(clearTimeout);
    for (const key of keys) {
      const data = pending.current[key];
      if (data === undefined) continue;
      const result = await api.saveSection(businessId, key, data);
      if (alive.current && !result.error) {
        setStatuses(result.statuses || {});
        setCompletion(result.completion || 0);
        setMissing(result.missing || []);
        delete pending.current[key];
      }
    }
    if (alive.current && Object.keys(pending.current).length === 0) setDirty(false);
    await refreshManifest(businessId);
  }, [businessId, refreshManifest]);

  return {
    business,
    sections: business?.sections || {},
    statuses,
    completion,
    missing,
    manifest,
    loading,
    error,
    saveState,
    dirty,
    setError,
    updateSection,
    flushAll,
    reload: load,
  };
}
