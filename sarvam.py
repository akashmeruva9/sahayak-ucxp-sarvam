"""Step 1 test — verified against sarvamai SDK v0.1.28"""
import os, base64
from dotenv import load_dotenv
from sarvamai import SarvamAI

load_dotenv()
client = SarvamAI(api_subscription_key=os.getenv("SARVAM_API_KEY"))

# --- Test 1: Telugu text-to-speech ---
resp = client.text_to_speech.convert(
    text="మీ ఆర్డర్ రేపు వస్తుంది. ధన్యవాదాలు!",
    target_language_code="te-IN",
    model="bulbul:v3",
    speaker="kavitha",
    output_audio_codec="wav",
)
with open("telugu_test.wav", "wb") as f:
    f.write(base64.b64decode(resp.audios[0]))
print("✅ TTS done — play telugu_test.wav")

# --- Test 2: LLM (105B!) ---
chat = client.chat.completions(
    model="sarvam-105b",
    messages=[{"role": "user",
               "content": "Reply in one short Telugu sentence: where is my order?"}],
    max_tokens=100,
)
print("✅ 105B says:", chat.choices[0].message.content)

# --- Test 3: STT round-trip (transcribe the audio we just made) ---
stt = client.speech_to_text.transcribe(
    file=open("telugu_test.wav", "rb"),
    model="saaras:v3",
    language_code="te-IN",
)
print("✅ Saaras heard:", stt.transcript)