"""Spoken-call courtesies, in the caller's language.

A call has manners a chat doesn't. On the phone the assistant has to hand the
turn back out loud — silence after an answer reads as a dropped line — so a
resolved spoken reply ends with an invitation to continue.

These are a fixed table rather than a translation call on purpose. The phrase
never changes, and a round trip to translate four known words would add latency
to the one surface where latency is most obvious: the pause before someone
hears a voice.

Chat is untouched. Reading "anything else?" under every message is clutter;
hearing it at the end of a spoken answer is how a call works.
"""

from __future__ import annotations

#: Language code -> the closing question, asked only when the turn is resolved.
FOLLOW_UP: dict[str, str] = {
    "en-IN": "Anything else I can help you with?",
    "hi-IN": "और कुछ पूछना चाहेंगे?",
    "te-IN": "ఇంకా ఏమైనా అడగాలనుకుంటున్నారా?",
    "ta-IN": "வேறு ஏதாவது கேட்க வேண்டுமா?",
    "kn-IN": "ಇನ್ನೇನಾದರೂ ಕೇಳಬೇಕೇ?",
    "ml-IN": "മറ്റെന്തെങ്കിലും ചോദിക്കണോ?",
    "bn-IN": "আর কিছু জানতে চান?",
    "mr-IN": "आणखी काही विचारायचं आहे का?",
    "gu-IN": "બીજું કંઈ પૂછવું છે?",
    "pa-IN": "ਹੋਰ ਕੁਝ ਪੁੱਛਣਾ ਹੈ?",
    "od-IN": "ଆଉ କିଛି ପଚାରିବେ କି?",
    "ur-IN": "کیا کچھ اور پوچھنا ہے؟",
}


#: Only voice needs this: the assistant can't hang up, and on a call the caller
#: is looking at a button rather than a keyboard.
HANG_UP: dict[str, str] = {
    "en-IN": "You can tap End call whenever you're ready.",
    "hi-IN": "जब आप तैयार हों, End call दबा दीजिए।",
    "te-IN": "మీరు సిద్ధంగా ఉన్నప్పుడు End call నొక్కండి.",
    "ta-IN": "நீங்கள் தயாராக இருக்கும்போது End call ஐ அழுத்தவும்.",
    "kn-IN": "ನೀವು ಸಿದ್ಧರಾದಾಗ End call ಒತ್ತಿರಿ.",
    "ml-IN": "തയ്യാറാകുമ്പോൾ End call അമർത്തുക.",
    "bn-IN": "প্রস্তুত হলে End call চাপুন।",
    "mr-IN": "तयार असाल तेव्हा End call दाबा.",
    "gu-IN": "તૈયાર હો ત્યારે End call દબાવો.",
    "pa-IN": "ਜਦੋਂ ਤਿਆਰ ਹੋਵੋ, End call ਦਬਾਓ।",
}


def hang_up_hint(language: str) -> str:
    """How to end the call, in the caller's language."""
    return HANG_UP.get(language) or HANG_UP["en-IN"]


def with_follow_up(reply: str, *, language: str, resolved: bool) -> str:
    """Append the closing question to a spoken reply.

    Only when the job is actually done. A turn that just asked "what's your
    order number?" is already handing the turn back — following it with
    "anything else?" would talk over its own question.
    """
    reply = (reply or "").strip()
    if not reply or not resolved:
        return reply

    phrase = FOLLOW_UP.get(language) or FOLLOW_UP["en-IN"]
    if phrase in reply:
        return reply
    return f"{reply} {phrase}"
