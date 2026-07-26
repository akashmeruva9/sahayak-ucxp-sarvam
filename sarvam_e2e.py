"""
UCXP End-to-End Sarvam Stack Test — hardened, error-transparent.
Full pipeline: Telugu voice IN -> STT -> lang-ID -> EN -> 105B(reads manifest)
               -> Telugu -> voice OUT, plus transliteration.
Verified against sarvamai SDK v0.1.28.
"""
import os, base64, json, time, re
from dotenv import load_dotenv
from sarvamai import SarvamAI
from sarvamai.core.request_options import RequestOptions

load_dotenv()
client = SarvamAI(api_subscription_key=os.getenv("SARVAM_API_KEY"))

OPTS = RequestOptions(timeout_in_seconds=90, max_retries=3)

def banner(n, name): print(f"\n{'='*58}\n  {n}. {name}\n{'='*58}")

def retry(fn, label, tries=3):
    for i in range(1, tries + 1):
        try:
            return fn()
        except Exception as e:
            # show the REAL error (first 300 chars) so we never guess
            print(f"   ...{label} attempt {i} failed: {type(e).__name__}: {str(e)[:300]}")
            time.sleep(2 * i)
    raise RuntimeError(f"{label} failed after {tries} tries")

def clean_one_sentence(text):
    """Strip any leaked reasoning; keep the answer line."""
    if not text:
        return "Sorry, I could not find that."
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for l in reversed(lines):
        if re.search(r"(ship|deliver|order|refund|return|1005|1006)", l, re.I) and not l[0].isdigit():
            return re.sub(r"\*+", "", l)[:300]
    return re.sub(r"\*+", "", lines[-1])[:300]

MANIFEST = {
    "business": "Meena Kitchen Store",
    "capabilities": ["track_order", "refund", "return_policy"],
    "orders": {
        "Meena_1006": {"item": "Mixer Grinder", "status": "DELIVERED", "amount": 785.95},
        "Meena_1005": {"item": "Pressure Cooker", "status": "SHIPPED", "amount": 2629.95},
    },
    "policies": {"return_policy": "Returns accepted within 7 days of delivery."},
}

# 1 -------------------------------------------------------------
banner(1, "TTS — make a Telugu customer voice note (input side)")
say = "నా ఆర్డర్ ఇంకా రాలేదు, అది ఎక్కడ ఉంది?"   # "my order hasn't arrived yet, where is it?"
r = retry(lambda: client.text_to_speech.convert(
    text=say, target_language_code="te-IN", model="bulbul:v3",
    speaker="kavitha", output_audio_codec="wav", request_options=OPTS), "TTS-in")
open("customer_note.wav", "wb").write(base64.b64decode(r.audios[0]))
print("Customer (TE):", say, "\n-> customer_note.wav")

# 2 -------------------------------------------------------------
banner(2, "STT (Saaras) — transcribe the voice note")
heard = retry(lambda: client.speech_to_text.transcribe(
    file=open("customer_note.wav", "rb"), model="saaras:v3",
    language_code="te-IN", request_options=OPTS), "STT").transcript
print("Saaras heard:", heard)

# 3 -------------------------------------------------------------
banner(3, "Language ID")
lang = retry(lambda: client.text.identify_language(
    input=heard, request_options=OPTS), "lang-id")
print("Detected:", lang.language_code, "| script:", getattr(lang, "script_code", "n/a"))

# 4 -------------------------------------------------------------
banner(4, "Translate -> English")
english = retry(lambda: client.text.translate(
    input=heard, source_language_code="te-IN", target_language_code="en-IN",
    model="mayura:v1", request_options=OPTS), "translate-en").translated_text
print("English:", english)

# 5 -------------------------------------------------------------
banner(5, "105B — read manifest, decide the answer")
sys = ("You are a customer-support agent. Below is a business support manifest as JSON. "
       "The customer's most recent order is Meena_1005. Look it up and reply with ONLY "
       "one short factual sentence for the customer about that order's status. "
       "No preamble, no reasoning, no lists.\n\nManifest:\n" + json.dumps(MANIFEST))
msg = retry(lambda: client.chat.completions(
    model="sarvam-105b",
    messages=[{"role": "system", "content": sys},
              {"role": "user", "content": english}],
    max_tokens=250, temperature=0.1, reasoning_effort="low",
    request_options=OPTS), "105b").choices[0].message
raw = msg.content or msg.reasoning_content or ""
ans_en = clean_one_sentence(raw)
print("Answer (EN):", ans_en)

# 6 -------------------------------------------------------------
banner(6, "Translate answer -> Telugu")
ans_te = retry(lambda: client.text.translate(
    input=ans_en, source_language_code="en-IN", target_language_code="te-IN",
    model="mayura:v1", request_options=OPTS), "translate-te").translated_text
print("Answer (TE):", ans_te)

# 7 -------------------------------------------------------------
banner(7, "TTS — speak the reply (output side)")
r2 = retry(lambda: client.text_to_speech.convert(
    text=ans_te, target_language_code="te-IN", model="bulbul:v3",
    speaker="kavitha", output_audio_codec="wav", request_options=OPTS), "TTS-out")
open("agent_reply.wav", "wb").write(base64.b64decode(r2.audios[0]))
print("-> agent_reply.wav  (play this — the full demo answer)")

# 8 -------------------------------------------------------------
banner(8, "Transliterate — Telugu answer in Roman script (bonus)")
roman = retry(lambda: client.text.transliterate(
    input=ans_te, source_language_code="te-IN", target_language_code="en-IN",
    request_options=OPTS), "translit").transliterated_text
print("Roman:", roman)

print("\n" + "="*58)
print("  PIPELINE PASSED — play customer_note.wav then agent_reply.wav")
print("="*58)