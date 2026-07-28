"""Document ingestion — PDF text extraction and image OCR.

Channel-agnostic on purpose. WhatsApp had this logic inline first; the app and
web need exactly the same behaviour, and two copies would drift the moment one
of them got a fix. Every channel now frames a document identically, so a photo
of an order resolves the same way whether it arrived over WhatsApp, the app, or
a browser.

Contains no business logic — it turns bytes into text and hands that text to the
runtime, which does the routing. `pytesseract` needs the `tesseract-ocr` binary
(installed in the Dockerfile); both imports are deferred so a missing optional
dependency degrades one document instead of failing app startup.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from loguru import logger

#: Reject oversized uploads before reading them into memory. Comfortably above
#: a phone screenshot or a multi-page invoice.
MAX_BYTES = 10 * 1024 * 1024

#: Bound the work a single PDF can cause. Order confirmations and bills are
#: short; a 400-page manual is not something we should spend a request on.
MAX_PDF_PAGES = 20

#: Content types we can read. Anything else is refused with a clear message
#: rather than silently producing empty text.
PDF_TYPES = {"application/pdf"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff", ".gif"}
PDF_SUFFIXES = {".pdf"}


@dataclass
class Extraction:
    """The outcome of reading one document.

    ``text`` is framed and ready to pass straight to ``runtime.run``; ``raw`` is
    the unframed extraction, kept for logging and for the client to preview.
    ``kind`` doubles as the key into :data:`EMPTY_MESSAGES` when ``ok`` is False.
    """

    ok: bool
    kind: str
    text: str = ""
    raw: str = ""
    error: str = ""


#: Customer-facing messages for each way extraction can come up empty. Phrased
#: as a next step, because "failed" alone leaves the customer stuck.
EMPTY_MESSAGES = {
    "pdf_empty": (
        "That PDF has no readable text (it may be a scan). "
        "Try sending a photo of it instead, or type the details."
    ),
    "image_empty": (
        "I couldn't read any text in that image. "
        "Try a clearer or closer photo, or type the details."
    ),
    "too_large": "That file is too large — please send something under 10 MB.",
    "unsupported": "I can read PDFs and photos or screenshots. Please send one of those, or type the details.",
    "extract_failed": "I couldn't open that file — it may be damaged. Try re-saving it, or type the details.",
}


def pdf_to_text(data: bytes) -> str:
    """Pull the text layer out of a PDF. Empty for scanned/image-only PDFs."""
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    pages = reader.pages[:MAX_PDF_PAGES]
    parts = [(page.extract_text() or "").strip() for page in pages]
    return "\n".join(p for p in parts if p).strip()


def image_to_text(data: bytes) -> str:
    """OCR a screenshot or photo.

    Screenshots are the common case (order pages, bills), so we preprocess for
    legibility — small phone-screen glyphs read badly at native size, and
    Tesseract does far better on an upscaled, grayscale image than on the raw
    capture.
    """
    import pytesseract
    from PIL import Image, ImageOps

    img = Image.open(BytesIO(data))
    img = ImageOps.exif_transpose(img)  # honour photo rotation
    img = img.convert("L")  # grayscale

    # Upscale small images so text is ~big enough for Tesseract's models.
    longest = max(img.size)
    if longest < 1600:
        factor = 1600 / longest
        img = img.resize((int(img.width * factor), int(img.height * factor)))
    img = ImageOps.autocontrast(img)

    text = pytesseract.image_to_string(img)
    return " ".join(text.split()).strip()


def frame_document(extracted: str, caption: str, source: str) -> str:
    """Present extracted document text to the runtime as reference material.

    Raw OCR/PDF text is noisy and isn't a user utterance, so we label it and ask
    the assistant to pull the relevant details (order id, ticket no, etc.) from
    it. Any caption the user typed alongside the file is their actual intent, so
    it leads. Generic — no business specifics.
    """
    caption = caption.strip()
    if caption:
        intent = caption
    else:
        # No caption: infer the most likely job from what the document shows and
        # act on it, rather than asking the customer to restate the obvious.
        intent = (
            "I'm sending this document — identify the business and what I most likely need "
            "from it (e.g. tracking an order, paying/checking a bill, an appointment, or a "
            "complaint) and go ahead with that."
        )
    return (
        f"{intent}\n\n"
        f"[The customer sent a {source}. Details extracted from it — use these to identify the "
        f"business and to fill any inputs you need (order number, booking reference, account id, "
        f"bill number, etc.):]\n"
        f"{extracted}"
    )


def _classify(content_type: str | None, filename: str | None) -> str:
    """Decide pdf/image/unsupported from the content type, then the extension.

    File pickers are unreliable about content types — a document picker on
    Android commonly reports `application/octet-stream` — so the filename is a
    necessary second opinion, not a fallback nicety.
    """
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in PDF_TYPES:
        return "pdf"
    if ctype.startswith("image/"):
        return "image"

    suffix = Path(filename or "").suffix.lower()
    if suffix in PDF_SUFFIXES:
        return "pdf"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    return "unsupported"


def extract(
    data: bytes,
    *,
    content_type: str | None = None,
    filename: str | None = None,
    caption: str = "",
) -> Extraction:
    """Read a document into runtime-ready text.

    Never raises: every failure comes back as ``ok=False`` with a ``kind`` that
    maps to a customer-facing line in :data:`EMPTY_MESSAGES`. A channel adapter
    should render that message rather than surfacing a stack trace.
    """
    if not data:
        return Extraction(ok=False, kind="unsupported", error="empty payload")
    if len(data) > MAX_BYTES:
        return Extraction(ok=False, kind="too_large", error=f"{len(data)} bytes")

    kind = _classify(content_type, filename)
    if kind == "unsupported":
        return Extraction(
            ok=False, kind="unsupported", error=f"content_type={content_type} filename={filename}"
        )

    try:
        raw = pdf_to_text(data) if kind == "pdf" else image_to_text(data)
    except Exception as exc:  # noqa: BLE001 — a bad file must not 500 the channel
        logger.warning(f"document.extract_failed kind={kind} file={filename} {exc}")
        return Extraction(ok=False, kind="extract_failed", error=str(exc))

    if not raw:
        return Extraction(ok=False, kind=f"{kind}_empty")

    source = "PDF" if kind == "pdf" else "screenshot/photo"
    logger.info(f"document.extracted kind={kind} file={filename} chars={len(raw)}")
    return Extraction(ok=True, kind=kind, text=frame_document(raw, caption, source), raw=raw)
