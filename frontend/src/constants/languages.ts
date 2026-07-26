/** Greetings across Indian languages — the multilingual showcase (Sarvam-style). */
export interface Greeting {
  code: string;
  /** Language name in its own script. */
  native: string;
  /** A short greeting in that language. */
  hello: string;
}

export const LANGUAGE_GREETINGS: Greeting[] = [
  { code: "hi", native: "हिन्दी", hello: "नमस्ते" },
  { code: "ta", native: "தமிழ்", hello: "வணக்கம்" },
  { code: "te", native: "తెలుగు", hello: "నమస్తే" },
  { code: "kn", native: "ಕನ್ನಡ", hello: "ನಮಸ್ಕಾರ" },
  { code: "bn", native: "বাংলা", hello: "নমস্কার" },
  { code: "mr", native: "मराठी", hello: "नमस्कार" },
  { code: "gu", native: "ગુજરાતી", hello: "નમસ્તે" },
  { code: "pa", native: "ਪੰਜਾਬੀ", hello: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ" },
  { code: "ml", native: "മലയാളം", hello: "നമസ്കാരം" },
  { code: "or", native: "ଓଡ଼ିଆ", hello: "ନମସ୍କାର" },
  { code: "ur", native: "اردو", hello: "السلام علیکم" },
  { code: "en", native: "English", hello: "Hello" },
];
