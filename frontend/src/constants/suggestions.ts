import type { SuggestedAction } from "@/types";

/** Curated "jobs to be done" surfaced on the Home screen. */
export const SUGGESTED_ACTIONS: SuggestedAction[] = [
  {
    id: "flipkart-track",
    title: "Track my Flipkart order",
    subtitle: "Where's my package?",
    businessId: "flipkart",
    prompt: "Track my latest Flipkart order",
  },
  {
    id: "airtel-cancel",
    title: "Cancel Airtel Fiber",
    subtitle: "Stop my broadband plan",
    businessId: "airtel",
    prompt: "I want to cancel my Airtel Fiber connection",
  },
  {
    id: "apollo-book",
    title: "Book Apollo appointment",
    subtitle: "Find a doctor near me",
    businessId: "apollo",
    prompt: "Book me an appointment at Apollo",
  },
  {
    id: "hdfc-complaint",
    title: "Raise a bank complaint",
    subtitle: "Report an issue to HDFC",
    businessId: "hdfc",
    prompt: "I want to raise a complaint with HDFC Bank",
  },
];
