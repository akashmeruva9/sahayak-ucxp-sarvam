"""Reads a merchant's public website and drafts their knowledge base.

The merchant pastes one URL. We open that page plus the handful of paths a
storefront almost always uses for policies and FAQs, pull the readable text out
of each, and ask Sarvam to turn it into question/answer pairs and four policy
bodies. Everything comes back marked ``draft`` -- this only ever *adds*
suggestions to Section 5, and every field stays editable, so a failed or empty
scrape leaves the merchant exactly where they started: typing it by hand.

Three things this module is careful about.

**It never fetches a private address.** A merchant-supplied URL is attacker-
controlled input. ``assert_public_host`` resolves the name first and refuses
loopback, private, link-local and reserved ranges, and it re-checks on every
redirect hop, because a public host can redirect to 127.0.0.1.

**It never trusts the model to fit.** On the starter tier ``max_tokens`` is
capped at 4096 and reasoning cannot be switched off, so the chain of thought
eats 1,700-2,900 tokens before a single content token is emitted. One combined
call truncates mid-JSON. We therefore make two narrow calls concurrently and,
critically, check ``finish_reason`` *before* parsing -- a truncated response is
discarded, never repaired and never read from ``reasoning_content``.

**It degrades instead of failing.** Nothing here can block onboarding. Every
outcome that is not a programming error returns HTTP 200 with a sentence the
merchant can act on.
"""

import asyncio
import html
import ipaddress
import json
import logging
import os
import re
import socket
import urllib.robotparser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

log = logging.getLogger("ucxp")

# --------------------------------------------------------------------------
# Limits. Every one of these is a guardrail, not a tuning knob -- raising them
# raises the blast radius of a hostile or merely enormous merchant site.
# --------------------------------------------------------------------------
MAX_PAGES = 8
MAX_BYTES_PER_PAGE = 2 * 1024 * 1024        # Shopify theme pages really are ~1 MB
MAX_BYTES_TOTAL = 8 * 1024 * 1024
PAGE_TIMEOUT_S = 10.0
ROBOTS_TIMEOUT_S = 5.0
# A full read measures 43-46s, and Sarvam's own latency swings by ~20s between
# identical calls. A 60s budget left so little headroom that identical imports
# succeeded or timed out at random, which reads to the merchant as a broken site.
TOTAL_BUDGET_S = 100.0
MAX_REDIRECTS = 3
FETCH_CONCURRENCY = 4
MIN_TEXT_CHARS = 200                        # below this the page is a JS shell

# Sarvam. max_tokens is a hard tier ceiling: 8000 is a 400, not a slow request.
SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions"
SARVAM_MODEL = "sarvam-105b"
SARVAM_MAX_TOKENS = 4096
SARVAM_TIMEOUT_S = 50.0
LLM_INPUT_CHARS = 9000                      # per call, measured to leave room to finish
MAX_FAQS = 8

# The "Mozilla/5.0 (compatible; …)" form is the convention every well-behaved
# crawler uses -- Googlebot and Bingbot both send exactly this shape. It still
# names us and links a contact page, so nothing here is a disguise; it simply
# gets past filters that reject any token they do not recognise. Storefronts
# behind bot protection turned a bare "UCXP/1.0" away in ~3s from a datacenter
# address while serving the same request from a residential one.
USER_AGENT = ("Mozilla/5.0 (compatible; SahayakBot/1.0; +https://ucxp.in/bot) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
POLICY_KEYS = ("return", "refund", "shipping", "warranty")

# Storefront paths worth trying blind. Shopify uses these exact ones on every
# store, which is why we do not need to crawl or read a sitemap.
POLICY_PATHS = (
    "/policies/refund-policy",
    "/policies/shipping-policy",
    "/policies/terms-of-service",
)
FAQ_PATHS = (
    "/pages/faq",
    "/pages/faqs",
    "/pages/shipping-returns",
    "/pages/help",
    "/pages/warranty",       # Shopify has no warranty policy path; this is the usual custom one
)
LINK_HINT = re.compile(
    r"(faq|help|support|return|refund|shipping|warranty|exchange|polic)", re.I
)

_TAG_BLOCKS = re.compile(
    r"<(script|style|noscript|svg|head|nav|footer|form)\b[^>]*>.*?</\1>",
    re.I | re.S,
)
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")
_POLICY_BODY = re.compile(
    r'<div[^>]*class="[^"]*shopify-policy__body[^"]*"[^>]*>(.*?)</div>\s*</div>', re.I | re.S
)
_MAIN = re.compile(r"<main\b[^>]*>(.*?)</main>", re.I | re.S)
_ARTICLE = re.compile(r"<article\b[^>]*>(.*?)</article>", re.I | re.S)
_LDJSON = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.I | re.S
)
_HREF = re.compile(r'<a\b[^>]*href="([^"#?]+)"[^>]*>(.*?)</a>', re.I | re.S)


class Blocked(Exception):
    """The URL is unusable and the merchant needs to be told why."""


# --------------------------------------------------------------------------
# URL hygiene and SSRF
# --------------------------------------------------------------------------
def normalise_url(raw):
    """Turn what the merchant typed into a URL we are willing to open."""
    text = (raw or "").strip()
    if not text:
        raise Blocked("Enter a full URL, e.g. https://yourbusiness.in/help")
    if "://" not in text:
        text = "https://" + text

    parts = urlsplit(text)
    if parts.scheme not in ("http", "https"):
        raise Blocked("We can only read http and https pages.")
    if "@" in parts.netloc:
        # user:pass@host is a classic way to disguise the real destination.
        raise Blocked("Enter a full URL, e.g. https://yourbusiness.in/help")
    host = (parts.hostname or "").lower()
    if not host or "." not in host:
        raise Blocked("Enter a full URL, e.g. https://yourbusiness.in/help")
    if parts.port not in (None, 80, 443):
        raise Blocked("We can only read pages on the standard web ports.")
    if host.endswith((".local", ".internal", ".localhost")):
        raise Blocked("That address isn't reachable from the public internet.")
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))


def assert_public_host(host):
    """Resolve `host` and refuse anything that is not a public address.

    Called before the first fetch and again on every redirect hop. Resolution
    happens here rather than inside the HTTP client so a name that maps to
    169.254.169.254 is rejected before a connection is ever opened.
    """
    name = (host or "").lower()
    if not name:
        raise Blocked("That address isn't reachable from the public internet.")
    try:
        infos = socket.getaddrinfo(name, None)
    except socket.gaierror:
        raise Blocked("We couldn't find that website. Check the address and try again.")
    if not infos:
        raise Blocked("We couldn't find that website. Check the address and try again.")

    for info in infos:
        raw = info[4][0]
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            raise Blocked("That address isn't reachable from the public internet.")
        if ip.version == 6 and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            # Deliberately vague: echoing the resolved IP would turn this into a
            # port scanner with a friendly error message.
            raise Blocked("That address isn't reachable from the public internet.")
    return True


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
async def _get(client, url, timeout):
    """One GET with a manual redirect loop, byte cap, and per-hop SSRF check."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        assert_public_host(urlsplit(current).hostname)
        async with client.stream("GET", current, timeout=timeout) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location", "")
                if not location:
                    return None, current, response.status_code
                current = urljoin(current, location)
                continue
            if response.status_code >= 400:
                # Worth a log line: a 403 here is a bot wall, and without the
                # status the failure is indistinguishable from a timeout.
                log.info("scrape.http_%s url=%s", response.status_code, current)
                return None, current, response.status_code
            ctype = response.headers.get("content-type", "")
            if "html" not in ctype.lower():
                return None, current, response.status_code

            chunks = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_BYTES_PER_PAGE:
                    break
                chunks.append(chunk)
            body = b"".join(chunks).decode(response.encoding or "utf-8", "replace")
            return body, current, response.status_code
    return None, current, 310


async def fetch_pages(urls):
    """Fetch up to MAX_PAGES concurrently. Failures are dropped, never raised."""
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    pages = {}
    total = 0

    async with httpx.AsyncClient(
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"},
    ) as client:

        async def one(url):
            nonlocal total
            async with semaphore:
                if total > MAX_BYTES_TOTAL:
                    return
                try:
                    body, final, status = await _get(client, url, PAGE_TIMEOUT_S)
                except Blocked:
                    return
                except Exception as exc:                    # noqa: BLE001 - any transport failure is just a miss
                    log.info("scrape.fetch_failed url=%s err=%s", url, type(exc).__name__)
                    return
                if body:
                    total += len(body)
                    pages[url] = {"html": body, "final_url": final, "status": status}

        await asyncio.gather(*(one(u) for u in urls[:MAX_PAGES]))
    return pages


async def robots_for(client, origin):
    """Fetch and parse robots.txt. An unreachable robots.txt means allow-all."""
    parser = urllib.robotparser.RobotFileParser()
    try:
        response = await client.get(origin + "/robots.txt", timeout=ROBOTS_TIMEOUT_S)
        if response.status_code == 200 and len(response.text) < 512_000:
            parser.parse(response.text.splitlines())
            return parser
    except Exception:                                        # noqa: BLE001
        pass
    parser.parse(["User-agent: *", "Allow: /"])
    return parser


# --------------------------------------------------------------------------
# Candidate discovery
# --------------------------------------------------------------------------
def candidate_urls(url, seed_html=None, robots=None):
    """The merchant's URL first, then the storefront paths, then real links."""
    parts = urlsplit(url)
    origin = "{}://{}".format(parts.scheme, parts.netloc)

    ordered = [url]
    for path in POLICY_PATHS + FAQ_PATHS:
        ordered.append(origin + path)

    if seed_html:
        for href, label in _HREF.findall(seed_html)[:400]:
            if not LINK_HINT.search(href) and not LINK_HINT.search(_TAGS.sub("", label)):
                continue
            target = urljoin(url, href)
            if urlsplit(target).netloc == parts.netloc:
                ordered.append(target)

    seen = set()
    out = []
    for candidate in ordered:
        clean = candidate.rstrip("/") or candidate
        if clean in seen:
            continue
        if robots is not None and not robots.can_fetch(USER_AGENT, candidate):
            continue
        seen.add(clean)
        out.append(candidate)
        if len(out) >= MAX_PAGES:
            break
    return out


# --------------------------------------------------------------------------
# Text extraction -- stdlib only, no bs4/lxml in this venv
# --------------------------------------------------------------------------
def extract_text(raw_html):
    """Readable prose from a page, or '' if there is nothing worth reading."""
    if not raw_html:
        return ""
    body = _TAG_BLOCKS.sub(" ", raw_html)

    for pattern in (_POLICY_BODY, _MAIN, _ARTICLE):
        found = pattern.search(body)
        if found and len(found.group(1)) > 400:
            body = found.group(1)
            break

    body = re.sub(r"</(p|div|li|h[1-6]|tr|section|summary|details)>", "\n", body, flags=re.I)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    text = html.unescape(_TAGS.sub(" ", body))
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANKS.sub("\n\n", text).strip()


def faqs_from_jsonld(raw_html):
    """Structured FAQs, when the site publishes them. Free and exact -- no LLM."""
    out = []
    for block in _LDJSON.findall(raw_html or ""):
        try:
            data = json.loads(block.strip())
        except (ValueError, TypeError):
            continue
        for node in data if isinstance(data, list) else [data]:
            if not isinstance(node, dict):
                continue
            graph = node.get("@graph") if isinstance(node.get("@graph"), list) else [node]
            for entry in graph:
                if not isinstance(entry, dict) or entry.get("@type") != "FAQPage":
                    continue
                for item in entry.get("mainEntity") or []:
                    if not isinstance(item, dict):
                        continue
                    answer = item.get("acceptedAnswer") or {}
                    question = (item.get("name") or "").strip()
                    body = (answer.get("text") or "").strip() if isinstance(answer, dict) else ""
                    if question and body:
                        out.append({"q": question, "a": extract_text(body) or body})
    return out


# --------------------------------------------------------------------------
# Sarvam
# --------------------------------------------------------------------------
FAQ_SCHEMA = {
    "type": "object",
    "properties": {
        "faqs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"q": {"type": "string"}, "a": {"type": "string"}},
                "required": ["q", "a"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["faqs"],
    "additionalProperties": False,
}

POLICY_SCHEMA = {
    "type": "object",
    "properties": {key: {"type": "string"} for key in POLICY_KEYS},
    "required": list(POLICY_KEYS),
    "additionalProperties": False,
}

FAQ_SYSTEM = (
    "You extract customer-support FAQs from a shop's own web pages. "
    "Return AT MOST {n} FAQs. Each answer at most 30 words. "
    "Use only facts present in the text -- never invent a number, a timeframe or a policy. "
    "Skip navigation, menus, cookie notices and marketing copy. "
    "Write answers in the shop's voice, addressed to the customer."
).format(n=MAX_FAQS)

# Each field is defined explicitly. Without definitions the model reliably files
# dispatch times under "return" and return rules under "refund" -- they are all
# "policy" to it, and the field names alone are not instructions.
POLICY_SYSTEM = (
    "You sort a shop's policy text into exactly four buckets. Each bucket has a "
    "strict meaning and must contain ONLY that topic:\n"
    "\n"
    "- return: whether goods can be sent back, who is eligible, the time window "
    "to raise a request, and the condition items must be in. NOT money, NOT delivery.\n"
    "- refund: how money comes back -- method, how long it takes to reach the "
    "customer, deductions or non-refundable fees. NOT eligibility, NOT delivery.\n"
    "- shipping: dispatch times, delivery estimates, couriers, shipping charges "
    "and free-shipping thresholds. NOT returns, NOT money coming back.\n"
    "- warranty: defect cover after purchase, its duration, and how to claim. "
    "NOT the return window.\n"
    "\n"
    "Rules. At most 80 words per field, plain prose, in the shop's voice, "
    "addressed to the customer. Use ONLY facts present in the text -- never "
    "invent or round a window, a fee, an amount or a condition, and copy every "
    "number exactly as written. If the text does not cover a bucket, return an "
    "empty string for it; an empty field is correct and far better than text "
    "borrowed from another bucket."
)


def _api_key():
    # Strip surrounding quotes: .env files commonly carry them, and a value
    # copied from one into a hosting provider's UI brings them along. A quoted
    # key is sent verbatim, rejected with a 403, and surfaces as "not
    # configured" -- which sends you looking for a missing variable that is
    # actually right there.
    key = (os.environ.get("SARVAM_API_KEY") or "").strip().strip("'\"").strip()
    if key:
        return key
    # The dashboard backend does not otherwise read .env; the root file is the
    # one place the key lives, and run.sh already refuses to start without it.
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        with open(os.path.join(root, ".env"), "r", encoding="utf-8") as handle:
            for line in handle:
                name, _, value = line.partition("=")
                if name.strip() == "SARVAM_API_KEY":
                    return value.strip().strip("'\"")
    except OSError:
        pass
    return ""


async def sarvam_json(client, system, user_text, schema, schema_name):
    """One structured Sarvam call. Returns a dict, or None if it could not finish.

    A truncated response is discarded outright. Repairing partial JSON or
    falling back to ``reasoning_content`` -- which is prose, not JSON -- would
    turn a clean miss into fabricated merchant policy.
    """
    key = _api_key()
    if not key:
        raise Blocked("The FAQ importer isn't configured on this server.")

    payload = {
        "model": SARVAM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.1,
        "max_tokens": SARVAM_MAX_TOKENS,
        "reasoning_effort": "low",
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        },
    }

    last = ""
    for attempt in range(3):
        try:
            response = await client.post(
                SARVAM_URL,
                json=payload,
                headers={"api-subscription-key": key, "Content-Type": "application/json"},
                timeout=SARVAM_TIMEOUT_S,
            )
        except Exception as exc:                              # noqa: BLE001
            last = type(exc).__name__
            await asyncio.sleep(2 * (attempt + 1))
            continue

        if response.status_code in (401, 403):
            raise Blocked("The FAQ importer isn't configured on this server.")
        if response.status_code == 400:
            # A schema or budget error will fail identically every time.
            log.error("scrape.sarvam_rejected body=%s", response.text[:400])
            return None
        if response.status_code >= 500 or response.status_code == 429:
            last = "HTTP {}".format(response.status_code)
            await asyncio.sleep(2 * (attempt + 1))
            continue

        choice = (response.json().get("choices") or [{}])[0]
        if choice.get("finish_reason") == "length":
            log.info("scrape.sarvam_truncated schema=%s", schema_name)
            return None
        content = (choice.get("message") or {}).get("content") or ""
        try:
            return json.loads(content)
        except (ValueError, TypeError):
            log.info("scrape.sarvam_unparseable schema=%s", schema_name)
            return None

    log.info("scrape.sarvam_unreachable schema=%s last=%s", schema_name, last)
    return None


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------
def _clip(chunks, limit):
    out = []
    used = 0
    for label, text in chunks:
        if used >= limit:
            break
        room = limit - used
        piece = text[:room]
        out.append("--- {} ---\n{}".format(label, piece))
        used += len(piece)
    return "\n\n".join(out)


def dedupe_faqs(rows, existing_questions=()):
    """Drop blanks, duplicates and anything already on the merchant's list."""
    seen = {(q or "").strip().lower() for q in existing_questions}
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        question = (row.get("q") or "").strip()
        answer = (row.get("a") or "").strip()
        # A half-filled FAQ would knock Section 5 from "done" back to "part".
        if not question or not answer:
            continue
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        entry = {"q": question[:300], "a": answer[:600], "draft": True}
        if row.get("source_url"):
            entry["source_url"] = row["source_url"]
        out.append(entry)
        if len(out) >= MAX_FAQS:
            break
    return out


def _looks_password_gated(pages):
    for page in pages.values():
        if "/password" in page.get("final_url", ""):
            return True
    return False


async def scrape(url, existing_questions=()):
    """Read a merchant site and draft their knowledge base.

    Always returns a dict. ``ok: False`` means we have a sentence for the
    merchant; ``ok: True`` with empty results means we read the site and found
    nothing, which is a normal outcome and not an error.
    """
    target = normalise_url(url)
    assert_public_host(urlsplit(target).hostname)
    origin = "{}://{}".format(*urlsplit(target)[:2])

    async with httpx.AsyncClient(
        follow_redirects=False, headers={"User-Agent": USER_AGENT}
    ) as probe:
        robots = await robots_for(probe, origin)

    seed = await fetch_pages([target])
    if not seed:
        # Large sites commonly answer a self-identifying reader with a hang or a
        # bot wall. Saying "check the address" sends the merchant hunting for a
        # typo they did not make.
        raise Blocked(
            "That site didn't respond to us — it may be blocking automated "
            "readers. Try your policies page directly, or add your FAQs below."
        )
    if _looks_password_gated(seed):
        raise Blocked(
            "That store isn't public yet — remove the storefront password, "
            "or paste your FAQs below."
        )

    seed_html = seed[target]["html"]
    pages = dict(seed)
    rest = [u for u in candidate_urls(target, seed_html, robots) if u not in pages]
    if rest:
        pages.update(await fetch_pages(rest))

    policy_first, faq_first, other, structured, read = [], [], [], [], []
    for page_url, page in pages.items():
        text = extract_text(page["html"])
        if len(text) < MIN_TEXT_CHARS:
            continue
        read.append(page_url)
        structured.extend(faqs_from_jsonld(page["html"]))
        if re.search(r"/policies/|policy|terms|return|refund|shipping|warranty",
                     page_url, re.I):
            policy_first.append((page_url, text))
        elif re.search(r"faq|help|support", page_url, re.I):
            faq_first.append((page_url, text))
        else:
            other.append((page_url, text))

    # Ordering matters more than it looks: _clip fills a fixed character budget
    # in order, and a storefront home page is easily 9,000 characters of
    # navigation. Put the pages that actually answer each question first, or the
    # home page crowds the real policy text out of the prompt entirely.
    faq_chunks = faq_first + other + policy_first
    policy_chunks = policy_first + other + faq_first

    if not read:
        raise Blocked(
            "We couldn't read any text on that page — it may load its content with "
            "JavaScript. Try your policies page, or type the FAQs below."
        )

    faqs, policies, notes = list(structured), {key: "" for key in POLICY_KEYS}, ""

    async with httpx.AsyncClient() as client:
        jobs = []
        # Structured FAQs are exact; only pay for the model when there are none.
        if not structured and faq_chunks:
            jobs.append(("faqs", sarvam_json(
                client, FAQ_SYSTEM, _clip(faq_chunks, LLM_INPUT_CHARS),
                FAQ_SCHEMA, "merchant_faqs")))
        if policy_chunks:
            jobs.append(("policies", sarvam_json(
                client, POLICY_SYSTEM, _clip(policy_chunks, LLM_INPUT_CHARS),
                POLICY_SCHEMA, "merchant_policies")))

        if jobs:
            results = await asyncio.gather(*(job for _, job in jobs),
                                           return_exceptions=True)
            for (name, _), result in zip(jobs, results):
                if isinstance(result, Blocked):
                    raise result
                if isinstance(result, Exception) or result is None:
                    notes = ("Some of that site was too long to read — we imported "
                             "what we could.")
                    continue
                if name == "faqs":
                    faqs.extend(result.get("faqs") or [])
                else:
                    for key in POLICY_KEYS:
                        value = (result.get(key) or "").strip()
                        if value:
                            policies[key] = value[:2000]

    drafts = dedupe_faqs(faqs, existing_questions)
    # Importing a second time legitimately yields nothing new. That is a
    # different outcome from finding nothing at all, and the caller has to be
    # able to tell them apart -- otherwise "you are already up to date" gets
    # reported to the merchant as a failure.
    duplicates = max(0, len(dedupe_faqs(faqs)) - len(drafts))
    if not drafts and not duplicates and not any(policies.values()):
        notes = notes or ("We read your pages but couldn't find clear FAQs. "
                          "Add them below.")

    return {
        "ok": True,
        "source": target,
        "faqs": drafts,
        "policies": policies,
        "pages_read": read,
        "duplicates_skipped": duplicates,
        "notes": notes,
    }
