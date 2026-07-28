"""Document ingestion — PDF text, image OCR, and every way they fail.

The failure paths matter as much as the happy one: an unreadable file has to
come back as a conversation turn telling the customer what to do differently,
never as a stack trace or an empty reply.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw

from backend.app.documents import (
    EMPTY_MESSAGES,
    MAX_BYTES,
    extract,
    frame_document,
)


def _png(text: str = "", size: tuple[int, int] = (900, 200)) -> bytes:
    img = Image.new("RGB", size, "white")
    if text:
        ImageDraw.Draw(img).text((20, 80), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _image_only_pdf() -> bytes:
    """A 'scanned' PDF: a valid PDF carrying no text layer."""
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), "white").save(buf, "PDF")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #
def test_image_with_text_is_ocred():
    result = extract(_png("Order 1001 Total Rs 1299"), content_type="image/png", filename="s.png")
    assert result.ok
    assert result.kind == "image"
    assert "1001" in result.raw


def test_extracted_text_is_framed_as_reference_not_as_the_users_words():
    """The runtime must not mistake OCR noise for something the customer said."""
    result = extract(_png("Order 1001"), content_type="image/png", filename="s.png")
    assert "[The customer sent a screenshot/photo" in result.text
    assert result.raw in result.text


def test_a_caption_leads_because_it_is_the_actual_intent():
    result = extract(
        _png("Order 1001"), content_type="image/png", filename="s.png", caption="where is this?"
    )
    assert result.text.startswith("where is this?")


def test_no_caption_falls_back_to_inferring_the_job():
    result = extract(_png("Order 1001"), content_type="image/png", filename="s.png")
    assert result.text.startswith("I'm sending this document")


# --------------------------------------------------------------------------- #
# Content-type classification
# --------------------------------------------------------------------------- #
def test_filename_decides_when_the_picker_lies_about_the_type():
    """Android document pickers routinely report application/octet-stream."""
    result = extract(
        _png("Order 1001"), content_type="application/octet-stream", filename="shot.PNG"
    )
    assert result.ok
    assert result.kind == "image"


def test_a_missing_content_type_still_classifies_by_extension():
    result = extract(_png("Order 1001"), content_type=None, filename="shot.jpeg")
    assert result.kind == "image"


def test_an_unreadable_format_is_refused_not_silently_empty():
    result = extract(b"PK\x03\x04", content_type="application/zip", filename="a.zip")
    assert not result.ok
    assert result.kind == "unsupported"
    assert EMPTY_MESSAGES["unsupported"]


# --------------------------------------------------------------------------- #
# Failure paths
# --------------------------------------------------------------------------- #
def test_a_scanned_pdf_reports_pdf_empty_and_suggests_a_photo():
    result = extract(_image_only_pdf(), content_type="application/pdf", filename="scan.pdf")
    assert not result.ok
    assert result.kind == "pdf_empty"
    assert "photo" in EMPTY_MESSAGES["pdf_empty"]


def test_a_blank_image_reports_image_empty():
    result = extract(_png(size=(400, 400)), content_type="image/png", filename="b.png")
    assert not result.ok
    assert result.kind == "image_empty"


def test_oversized_files_are_rejected_before_being_parsed():
    result = extract(b"x" * (MAX_BYTES + 1), content_type="image/png", filename="big.png")
    assert not result.ok
    assert result.kind == "too_large"


def test_a_corrupt_file_degrades_instead_of_raising():
    result = extract(b"this is not a pdf", content_type="application/pdf", filename="a.pdf")
    assert not result.ok
    assert result.kind == "extract_failed"


def test_empty_payload_is_handled():
    assert not extract(b"", content_type="application/pdf", filename="a.pdf").ok


@pytest.mark.parametrize("kind", ["pdf_empty", "image_empty", "too_large", "unsupported", "extract_failed"])
def test_every_failure_kind_has_a_customer_facing_message(kind):
    """A `kind` with no message would surface as a blank bubble."""
    assert EMPTY_MESSAGES.get(kind)


# --------------------------------------------------------------------------- #
# Framing
# --------------------------------------------------------------------------- #
def test_framing_names_the_source_so_the_model_knows_what_it_is_reading():
    assert "PDF" in frame_document("Order 1001", "", "PDF")
    assert "screenshot/photo" in frame_document("Order 1001", "", "screenshot/photo")


def test_framing_carries_no_business_specifics():
    """The runtime stays generic — PLAN.md §2. No business may leak into a prompt."""
    framed = frame_document("Order 1001", "where is it", "PDF").lower()
    for business in ("flipkart", "airtel", "apollo", "shopify", "ravi"):
        assert business not in framed
