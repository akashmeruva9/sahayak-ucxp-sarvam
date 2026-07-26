import type { Business, BusinessId } from "@/types";

/**
 * The business directory is **learned from the runtime** (GET /businesses,
 * derived from manifests) — the app hardcodes nothing. This module keeps a
 * small in-memory cache so the many synchronous `getBusiness(id)` call sites
 * (badges, avatars) stay simple; `setBusinesses()` fills it once the directory
 * loads. See `api/businesses.ts` + `hooks/useBusinesses.ts`.
 */

export const GENERIC_BUSINESS: Business = {
  id: "generic",
  name: "Sahayak",
  glyph: "✦",
  color: "#EA580C",
  tint: "#FCE7D6",
  category: "Other",
};

const _cache = new Map<string, Business>();

/** Derive a soft background tint from a hex brand color. */
function tintFor(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#F2EBDF";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Blend heavily toward white for a gentle chip background.
  const mix = (c: number) => Math.round(c + (255 - c) * 0.86);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Replace the cached directory with what the runtime returned. */
export function setBusinesses(list: Business[]): void {
  _cache.clear();
  for (const b of list) {
    _cache.set(b.id, { ...b, tint: b.tint || tintFor(b.color) });
  }
}

export function getBusiness(id?: BusinessId): Business {
  if (!id || id === "generic") return GENERIC_BUSINESS;
  return _cache.get(id) ?? { ...GENERIC_BUSINESS, id, name: id };
}

/** All real businesses currently known (excludes the generic fallback). */
export function listBusinesses(): Business[] {
  return [..._cache.values()].filter((b) => b.id !== "generic");
}

/** Category display order — derived from what's loaded, stable + alphabetical. */
export function categoryOrder(): string[] {
  return [...new Set(listBusinesses().map((b) => b.category))].sort();
}
