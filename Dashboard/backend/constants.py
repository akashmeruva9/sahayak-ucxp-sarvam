"""Shared vocabulary for UCXP: languages, categories, capabilities, auth methods.

These values are mirrored verbatim in frontend/src/lib/ so the live JSON preview and
the server-assembled manifest can never drift. tests/backend/test_contract.py asserts
the two stay in sync.
"""

# --- Languages -------------------------------------------------------------
# Order matters: this is the order the chips render in Section 4.
#
# `voice` records whether Sarvam can *speak* the language, not whether we
# support it. Saaras (STT) and Sarvam-Translate both cover 23 languages, but
# Bulbul v3 speaks 11: bn, en, gu, hi, kn, ml, mr, od, pa, ta, te. Assamese and
# Urdu are understood and answered in text, and handed off rather than spoken.
# Section 4 says so on the chip, because a merchant who ticks Urdu expecting a
# voice reply has promised their customer something the stack cannot deliver.
LANGUAGES = [
    {"code": "te", "native": "తెలుగు", "english": "Telugu", "voice": True},
    {"code": "hi", "native": "हिंदी", "english": "Hindi", "voice": True},
    {"code": "ta", "native": "தமிழ்", "english": "Tamil", "voice": True},
    {"code": "kn", "native": "ಕನ್ನಡ", "english": "Kannada", "voice": True},
    {"code": "ml", "native": "മലയാളം", "english": "Malayalam", "voice": True},
    {"code": "bn", "native": "বাংলা", "english": "Bengali", "voice": True},
    {"code": "mr", "native": "मराठी", "english": "Marathi", "voice": True},
    {"code": "gu", "native": "ગુજરાતી", "english": "Gujarati", "voice": True},
    {"code": "pa", "native": "ਪੰਜਾਬੀ", "english": "Punjabi", "voice": True},
    {"code": "or", "native": "ଓଡ଼ିଆ", "english": "Odia", "voice": True},
    {"code": "as", "native": "অসমীয়া", "english": "Assamese", "voice": False},
    {"code": "ur", "native": "اردو", "english": "Urdu", "voice": False},
    {"code": "en", "native": "English", "english": "English", "voice": True},
]
LANGUAGE_CODES = [lang["code"] for lang in LANGUAGES]
VOICE_LANGUAGE_CODES = [lang["code"] for lang in LANGUAGES if lang["voice"]]

# Sarvam spells Odia `od-IN`. ISO 639-1 spells it `or`, which is what we key on
# internally, so the two have to be reconciled at exactly one point -- here, on
# the way out to a manifest. Sending `or-IN` to Bulbul or Saaras is a 400.
BCP47_OVERRIDES = {"or": "od"}


def to_bcp47(code):
    """'te' -> 'te-IN'. Every UCXP language is an Indian locale, English included."""
    return "{}-IN".format(BCP47_OVERRIDES.get(code, code))


# --- Categories (Section 1 dropdown) ---------------------------------------
CATEGORIES = [
    "Apparel & Textiles",
    "Food & Beverage",
    "Handicrafts",
    "Wellness & Ayurveda",
    "Jewellery",
    "Electronics",
    "Home & Living",
    "Books & Stationery",
    "Sports & Fitness",
]

# --- Custom REST auth methods (Section 2) ----------------------------------
AUTH_METHODS = [
    {"key": "api_key_header", "label": "API key header", "header": "X-API-Key"},
    {"key": "bearer_token", "label": "Bearer token", "header": "Authorization"},
    {"key": "basic_auth", "label": "Basic auth", "header": "Authorization"},
]

HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"]

# --- The seven capabilities ------------------------------------------------
# `default_*` values are placeholders in the editor and the seed used when a
# capability is enabled with Shopify connected. For Custom REST / None the
# contract starts EMPTY and fully editable -- see manifest.empty_contract().
CAPABILITIES = [
    {
        "key": "track_order",
        "title": "Track order",
        "description": "Live status for \"Where is my order?\"",
        "default_path": "/api/orders/{order_id}",
        "default_method": "GET",
        "default_request": '{\n  "order_id": "ORD-1042"\n}',
        "default_response": (
            '{\n  "status": "in_transit",\n  "courier": "Delhivery",\n'
            '  "eta": "2026-07-29",\n  "tracking_url": "https://track.example.com/ORD-1042"\n}'
        ),
    },
    {
        "key": "refund",
        "title": "Refund",
        "description": "Initiate and track refunds",
        "default_path": "/api/orders/{order_id}/refund",
        "default_method": "POST",
        "default_request": '{\n  "order_id": "ORD-1042",\n  "reason": "damaged_on_arrival"\n}',
        "default_response": (
            '{\n  "refund_id": "rf_88h2",\n  "status": "initiated",\n  "amount": 12499,\n'
            '  "currency": "INR",\n  "eta_days": 5\n}'
        ),
    },
    {
        "key": "return_policy",
        "title": "Return policy",
        "description": "Eligibility, windows and conditions",
        "default_path": "/api/policies/return",
        "default_method": "GET",
        "default_request": '{\n  "product_id": "SKU-201"\n}',
        "default_response": (
            '{\n  "returnable": true,\n  "window_days": 7,\n'
            '  "conditions": "Unworn, tags intact"\n}'
        ),
    },
    {
        "key": "reorder",
        "title": "Reorder",
        "description": "One-tap repeat purchase",
        "default_path": "/api/orders/{order_id}/reorder",
        "default_method": "POST",
        "default_request": '{\n  "order_id": "ORD-0977"\n}',
        "default_response": (
            '{\n  "new_order_id": "ORD-1105",\n  "status": "created",\n'
            '  "payment_link": "https://pay.yourbusiness.in/ORD-1105"\n}'
        ),
    },
    {
        "key": "warranty",
        "title": "Warranty",
        "description": "Coverage checks and claims",
        "default_path": "/api/warranty/{product_id}",
        "default_method": "GET",
        "default_request": '{\n  "product_id": "SKU-201"\n}',
        "default_response": (
            '{\n  "covered": true,\n  "expires": "2027-01-15",\n'
            '  "claim_url": "https://yourbusiness.in/warranty"\n}'
        ),
    },
    {
        "key": "exchange",
        "title": "Exchange",
        "description": "Swap size, colour or item",
        "default_path": "/api/orders/{order_id}/exchange",
        "default_method": "POST",
        "default_request": '{\n  "order_id": "ORD-1042",\n  "new_variant": "SKU-201-RED"\n}',
        "default_response": (
            '{\n  "exchange_id": "ex_31kq",\n  "status": "approved",\n'
            '  "pickup_eta": "2026-07-30"\n}'
        ),
    },
    {
        "key": "cancel_order",
        "title": "Cancel order",
        "description": "Cancel before dispatch",
        "default_path": "/api/orders/{order_id}/cancel",
        "default_method": "POST",
        "default_request": '{\n  "order_id": "ORD-1042"\n}',
        "default_response": '{\n  "status": "cancelled",\n  "refund_eta_days": 3\n}',
    },
]
CAPABILITY_KEYS = [cap["key"] for cap in CAPABILITIES]
CAPABILITY_BY_KEY = {cap["key"]: cap for cap in CAPABILITIES}

# Capabilities the Shopify connector can auto-configure from a live store.
SHOPIFY_AUTO_CAPABILITIES = ["track_order", "refund"]
SHOPIFY_SCOPES = ["read_orders", "read_products"]

# Prefilled error rows. The design seeds 404; the brief requires 404/401/500.
DEFAULT_ERRORS = [
    {"code": "404", "meaning": "Order not found",
     "customer_message": "Sorry, we couldn't find that order number"},
    {"code": "401", "meaning": "Authentication failed",
     "customer_message": "I'm having trouble reaching the store right now"},
    {"code": "500", "meaning": "Server error",
     "customer_message": "Something went wrong on our side. Please try again shortly"},
]

# --- Escalation defaults (Consumer Protection (E-Commerce) Rules, 2020) -----
DEFAULT_FIRST_RESPONSE_HOURS = "48"
DEFAULT_RESOLUTION_DAYS = "30"
NATIONAL_CONSUMER_HELPLINE = "1915 · consumerhelpline.gov.in"

SECTION_LABELS = {
    1: "Business profile",
    2: "Data source",
    3: "API capabilities",
    4: "Languages",
    5: "Knowledge base",
    6: "Escalation & SLA",
    7: "Review & activate",
}

# Sentinel written into the manifest when an example body is not parseable JSON.
INVALID_JSON_SENTINEL = "⚠ invalid JSON — fix in Section 3"
