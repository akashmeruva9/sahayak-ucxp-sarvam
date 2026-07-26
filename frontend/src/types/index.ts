/**
 * Core domain types for the Unified Customer Experience Protocol (UCXP)
 * reference client. These mirror the shapes the future backend will return,
 * so the UI never has to change when the mocks are swapped for real endpoints.
 */

export type BusinessId =
  // Shopping
  | "flipkart"
  | "amazon"
  | "myntra"
  | "meesho"
  // Food & Delivery
  | "swiggy"
  | "zomato"
  | "blinkit"
  | "zepto"
  // Telecom
  | "airtel"
  | "jio"
  | "vi"
  | "bsnl"
  // Banking & Payments
  | "hdfc"
  | "icici"
  | "sbi"
  | "phonepe"
  | "paytm"
  // Travel
  | "irctc"
  | "ola"
  | "uber"
  | "makemytrip"
  | "indigo"
  // Entertainment
  | "netflix"
  | "hotstar"
  | "spotify"
  // Healthcare
  | "apollo"
  | "practo"
  | "pharmeasy"
  // Fallback
  | "generic";

export type BusinessCategory =
  | "Shopping"
  | "Food & Delivery"
  | "Telecom"
  | "Banking & Payments"
  | "Travel"
  | "Entertainment"
  | "Healthcare"
  | "Other";

export interface Business {
  id: BusinessId;
  name: string;
  /** Emoji or single glyph used inside the BusinessBadge/avatar. */
  glyph: string;
  /** Brand color used for the badge accent (works on light + dark). */
  color: string;
  /** Soft background tint for the badge chip / avatar. */
  tint: string;
  /** Directory grouping. */
  category: BusinessCategory;
}

export type MessageRole = "user" | "assistant";

export type MessageStatus = "sending" | "sent" | "error";

/** A structured status line a UCXP business can attach to a reply. */
export interface BusinessAction {
  label: string; // e.g. "Order arriving tomorrow."
  tone?: "info" | "success" | "warning";
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  status?: MessageStatus;
  /** Optional business the assistant is acting on behalf of. */
  businessId?: BusinessId;
  /** Optional structured outcome shown as a card inside the bubble. */
  action?: BusinessAction;
  /** Flags a placeholder bubble that should render the typing animation. */
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  businessId?: BusinessId;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

/** Lightweight projection used by the History list. */
export interface ConversationSummary {
  id: string;
  title: string;
  businessId?: BusinessId;
  preview: string;
  updatedAt: number;
}

export interface SuggestedAction {
  id: string;
  title: string;
  subtitle: string;
  businessId: BusinessId;
  prompt: string;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Language {
  code: string;
  label: string;
  native: string;
}
