import type { Business, SuggestedAction } from "@/types";

/**
 * Suggested "jobs to be done" for Home, derived from the real businesses the
 * runtime exposes — no hardcoded companies. Each business's capabilities decide
 * which actions are offered.
 */
const CAPABILITY_LABELS: Record<string, { title: string; subtitle: string; prompt: string }> = {
  track_order: {
    title: "Track my {name} order",
    subtitle: "Where's my order?",
    prompt: "Where is my order?",
  },
  refund: {
    title: "Request a {name} refund",
    subtitle: "Get your money back",
    prompt: "I'd like a refund for my order",
  },
  cancel_order: {
    title: "Cancel my {name} order",
    subtitle: "Stop an order",
    prompt: "I want to cancel my order",
  },
};

export function suggestionsFor(businesses: Business[], limit = 4): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  for (const business of businesses) {
    // One primary action per business (prefer track_order) so the grid spans
    // businesses rather than repeating one.
    const capId = business.capabilities?.includes("track_order")
      ? "track_order"
      : business.capabilities?.[0];
    const spec = capId ? CAPABILITY_LABELS[capId] : undefined;
    if (!spec) continue;
    out.push({
      id: `${business.id}-${capId}`,
      title: spec.title.replace("{name}", business.name),
      subtitle: spec.subtitle,
      businessId: business.id,
      prompt: spec.prompt,
    });
    if (out.length >= limit) break;
  }
  return out;
}
