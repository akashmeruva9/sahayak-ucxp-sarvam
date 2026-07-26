import type { Business, BusinessCategory, BusinessId } from "@/types";

/**
 * The registry of businesses reachable over UCXP. In production this comes
 * from a directory endpoint; here it is a static, typed map.
 */
export const BUSINESSES: Record<BusinessId, Business> = {
  // Shopping
  flipkart: { id: "flipkart", name: "Flipkart", glyph: "🛍", color: "#2874F0", tint: "#E7F0FF", category: "Shopping" },
  amazon: { id: "amazon", name: "Amazon", glyph: "📦", color: "#E67A00", tint: "#FFF1DC", category: "Shopping" },
  myntra: { id: "myntra", name: "Myntra", glyph: "👗", color: "#FF3F6C", tint: "#FFE3EB", category: "Shopping" },
  meesho: { id: "meesho", name: "Meesho", glyph: "🛒", color: "#9F2089", tint: "#F7E1F3", category: "Shopping" },

  // Food & Delivery
  swiggy: { id: "swiggy", name: "Swiggy", glyph: "🍔", color: "#FC8019", tint: "#FFEEDD", category: "Food & Delivery" },
  zomato: { id: "zomato", name: "Zomato", glyph: "🍽", color: "#E23744", tint: "#FCE1E4", category: "Food & Delivery" },
  blinkit: { id: "blinkit", name: "Blinkit", glyph: "🛵", color: "#C79200", tint: "#FBF3D5", category: "Food & Delivery" },
  zepto: { id: "zepto", name: "Zepto", glyph: "⚡", color: "#6C3DF4", tint: "#E9E2FD", category: "Food & Delivery" },

  // Telecom
  airtel: { id: "airtel", name: "Airtel", glyph: "📶", color: "#E4002B", tint: "#FEE7EC", category: "Telecom" },
  jio: { id: "jio", name: "Jio", glyph: "📱", color: "#0A2885", tint: "#E0E5F3", category: "Telecom" },
  vi: { id: "vi", name: "Vi", glyph: "📞", color: "#ED1C24", tint: "#FDE2E3", category: "Telecom" },
  bsnl: { id: "bsnl", name: "BSNL", glyph: "☎️", color: "#D9741C", tint: "#FDECDD", category: "Telecom" },

  // Banking & Payments
  hdfc: { id: "hdfc", name: "HDFC Bank", glyph: "🏦", color: "#004C8F", tint: "#E1EEFB", category: "Banking & Payments" },
  icici: { id: "icici", name: "ICICI Bank", glyph: "🏛", color: "#AE282E", tint: "#F6E2E3", category: "Banking & Payments" },
  sbi: { id: "sbi", name: "SBI", glyph: "💳", color: "#22409A", tint: "#E2E7F5", category: "Banking & Payments" },
  phonepe: { id: "phonepe", name: "PhonePe", glyph: "💜", color: "#5F259F", tint: "#EBE1F5", category: "Banking & Payments" },
  paytm: { id: "paytm", name: "Paytm", glyph: "💙", color: "#0392C4", tint: "#DBF4FD", category: "Banking & Payments" },

  // Travel
  irctc: { id: "irctc", name: "IRCTC", glyph: "🚆", color: "#213C82", tint: "#E4E9F7", category: "Travel" },
  ola: { id: "ola", name: "Ola", glyph: "🚕", color: "#1F2937", tint: "#EAECEF", category: "Travel" },
  uber: { id: "uber", name: "Uber", glyph: "🚗", color: "#111827", tint: "#EBECEE", category: "Travel" },
  makemytrip: { id: "makemytrip", name: "MakeMyTrip", glyph: "✈️", color: "#EB2226", tint: "#FBE1E1", category: "Travel" },
  indigo: { id: "indigo", name: "IndiGo", glyph: "🛫", color: "#001B94", tint: "#E0E2F3", category: "Travel" },

  // Entertainment
  netflix: { id: "netflix", name: "Netflix", glyph: "🎬", color: "#E50914", tint: "#FBE0E1", category: "Entertainment" },
  hotstar: { id: "hotstar", name: "Hotstar", glyph: "⭐", color: "#1F80E0", tint: "#E1EEFB", category: "Entertainment" },
  spotify: { id: "spotify", name: "Spotify", glyph: "🎧", color: "#1DB954", tint: "#DEF6E6", category: "Entertainment" },

  // Healthcare
  apollo: { id: "apollo", name: "Apollo", glyph: "🩺", color: "#0EA66E", tint: "#DEF7EC", category: "Healthcare" },
  practo: { id: "practo", name: "Practo", glyph: "👩‍⚕️", color: "#0FA0C9", tint: "#DEF5FC", category: "Healthcare" },
  pharmeasy: { id: "pharmeasy", name: "PharmEasy", glyph: "💊", color: "#10847E", tint: "#DCF2F1", category: "Healthcare" },

  // Fallback (never shown in the directory)
  generic: { id: "generic", name: "OneSupport", glyph: "✦", color: "#2563EB", tint: "#DBEAFE", category: "Other" },
};

export function getBusiness(id?: BusinessId): Business {
  if (!id) return BUSINESSES.generic;
  return BUSINESSES[id] ?? BUSINESSES.generic;
}

/** Display order for the directory's category sections. */
export const CATEGORY_ORDER: BusinessCategory[] = [
  "Shopping",
  "Food & Delivery",
  "Telecom",
  "Banking & Payments",
  "Travel",
  "Entertainment",
  "Healthcare",
];

/** All real, user-facing businesses (excludes the generic fallback). */
export function listBusinesses(): Business[] {
  return Object.values(BUSINESSES).filter((b) => b.id !== "generic");
}
