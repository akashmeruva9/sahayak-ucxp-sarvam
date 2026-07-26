import type { Business } from "@/types";
import { setBusinesses } from "@/constants/businesses";
import { getJson, isMockMode } from "./client";

/** The runtime's GET /businesses shape — PLAN.md §6 (derived from manifests). */
interface RuntimeBusiness {
  id: string;
  name: string;
  category: string;
  glyph: string;
  color: string;
  capabilities?: string[];
  languages?: string[];
}

/**
 * GET /businesses — the directory, straight from the runtime's manifests.
 * Populates the local cache so synchronous `getBusiness()` works everywhere,
 * and returns the list for the Companies screen.
 */
export async function fetchBusinesses(): Promise<Business[]> {
  if (isMockMode()) return [];
  const rows = await getJson<RuntimeBusiness[]>("/businesses");
  const businesses: Business[] = rows.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category || "Other",
    glyph: b.glyph || "🏢",
    color: b.color || "#64748B",
    tint: "", // derived in setBusinesses()
    capabilities: b.capabilities,
  }));
  setBusinesses(businesses);
  return businesses;
}
