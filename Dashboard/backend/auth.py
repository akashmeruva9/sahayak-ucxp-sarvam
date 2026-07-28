"""Google sign-in and the session cookie.

Direct OAuth against Google. No Auth0, no Clerk, no Firebase -- those add a
second dashboard, a second set of secrets, and you would still be verifying the
token here. The whole dependency cost of this file is `itsdangerous`.

Two roles:
  admin     -- an address listed in UCXP_ADMIN_EMAILS. Sees every business.
  merchant  -- anyone else who signs in. Sees only businesses they own.

Auth is *off* unless it is configured, so local development and the test suite
run exactly as they did before. That is a convenience, not a default for a
hosted deployment -- set UCXP_REQUIRE_AUTH=1 there and a missing variable
becomes a refusal to start rather than a dashboard that is quietly public.
"""

import base64
import json
import logging
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

log = logging.getLogger("ucxp")

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = "openid email profile"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")

SESSION_COOKIE = "ucxp_session"
STATE_COOKIE = "ucxp_oauth_state"
SESSION_MAX_AGE = 14 * 24 * 3600
STATE_MAX_AGE = 600

CALLBACK_PATH = "/api/auth/callback"


def _env(name, default=""):
    return (os.environ.get(name) or default).strip()


def client_id():
    return _env("GOOGLE_CLIENT_ID")


def _client_secret():
    return _env("GOOGLE_CLIENT_SECRET")


def _session_secret():
    # Falling back to the client secret means one less variable to set and is
    # no weaker -- it is already a high-entropy value only this server holds.
    return _env("UCXP_SESSION_SECRET") or _client_secret()


def admin_emails():
    raw = _env("UCXP_ADMIN_EMAILS")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def required():
    """True when a deployment has declared that sign-in is mandatory."""
    return _env("UCXP_REQUIRE_AUTH").lower() in ("1", "true", "yes", "on")


def enabled():
    """True when sign-in is configured well enough to actually run."""
    return bool(client_id() and _client_secret() and _session_secret())


def check_startup_config():
    """Refuse to start a deployment that asked for auth and cannot do it.

    Returns a list of warnings for the merely-unconfigured case. Raises
    RuntimeError when UCXP_REQUIRE_AUTH is set but something is missing --
    failing to boot is the only safe response, because the alternative is an
    admin console open to anyone who finds the URL.
    """
    missing = [name for name, value in (
        ("GOOGLE_CLIENT_ID", client_id()),
        ("GOOGLE_CLIENT_SECRET", _client_secret()),
    ) if not value]

    if required():
        if missing:
            raise RuntimeError(
                "UCXP_REQUIRE_AUTH is set but {} {} not configured. Refusing to "
                "start rather than serve an unauthenticated dashboard.".format(
                    " and ".join(missing), "is" if len(missing) == 1 else "are"))
        if not admin_emails():
            raise RuntimeError(
                "UCXP_REQUIRE_AUTH is set but UCXP_ADMIN_EMAILS is empty, so no "
                "one could reach the admin console. Set it to your Google "
                "address.")
        return []

    if enabled():
        return [] if admin_emails() else [
            "Google sign-in is on but UCXP_ADMIN_EMAILS is empty -- everyone who "
            "signs in will be treated as a merchant and the admin console will "
            "be unreachable."]
    return ["Google sign-in is not configured, so the dashboard is open to "
            "anyone who can reach it. Set GOOGLE_CLIENT_ID, "
            "GOOGLE_CLIENT_SECRET and UCXP_ADMIN_EMAILS, plus "
            "UCXP_REQUIRE_AUTH=1, on any host."]


def _serializer(salt):
    return URLSafeTimedSerializer(_session_secret(), salt=salt)


# --------------------------------------------------------------------------
# Where Google should send the browser back to
# --------------------------------------------------------------------------
def base_url(request):
    """The origin this app is reached at, for building redirect_uri.

    Must match a URI registered on the Google client character for character,
    so an explicit override wins over anything inferred. Behind Railway's proxy
    the scheme has to come from X-Forwarded-Proto, since the app itself is
    speaking plain HTTP.
    """
    override = _env("UCXP_AUTH_BASE_URL")
    if override:
        return override.rstrip("/")
    headers = request.headers
    host = headers.get("x-forwarded-host") or headers.get("host") or ""
    scheme = headers.get("x-forwarded-proto") or request.url.scheme or "http"
    # A proxy chain sends a comma-separated list; the first entry is the client.
    scheme = scheme.split(",")[0].strip()
    host = host.split(",")[0].strip()
    if not host:
        return str(request.base_url).rstrip("/")
    return "{}://{}".format(scheme, host)


def redirect_uri(request):
    return base_url(request) + CALLBACK_PATH


def is_secure(request):
    return base_url(request).startswith("https://")


# --------------------------------------------------------------------------
# The two hops
# --------------------------------------------------------------------------
def authorize_url(request, next_path="/"):
    """Step one: where to send the browser, plus the state to remember."""
    nonce = secrets.token_urlsafe(16)
    state = _serializer("ucxp-oauth-state").dumps({"n": nonce, "r": _safe_next(next_path)})
    params = {
        "client_id": client_id(),
        "redirect_uri": redirect_uri(request),
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
        "access_type": "online",
        # Without this a second sign-in silently reuses the first account, which
        # is baffling when you are trying to switch between admin and merchant.
        "prompt": "select_account",
    }
    return "{}?{}".format(AUTHORIZE_URL, urllib.parse.urlencode(params)), nonce


def _safe_next(path):
    """Only ever return to a path on this site -- never to another origin."""
    if not path or not path.startswith("/") or path.startswith("//"):
        return "/"
    return path


def read_state(state, nonce_cookie):
    """Step two, part one: prove this callback answers a login we started.

    The signed state alone proves it came from us; pairing it with a nonce held
    in a cookie proves it came from *this browser*, which is what stops someone
    walking a victim through a login to an account they control.
    """
    if not state:
        raise AuthError("That sign-in link is incomplete. Please try again.")
    try:
        data = _serializer("ucxp-oauth-state").loads(state, max_age=STATE_MAX_AGE)
    except SignatureExpired:
        raise AuthError("That sign-in took too long. Please try again.")
    except BadSignature:
        raise AuthError("We couldn't verify that sign-in. Please try again.")
    if not nonce_cookie or not secrets.compare_digest(str(data.get("n", "")), str(nonce_cookie)):
        raise AuthError("That sign-in didn't start in this browser. Please try again.")
    return _safe_next(data.get("r"))


class AuthError(Exception):
    """Something a signing-in human should read, never a stack trace."""


def exchange_code(request, code):
    """Step two, part two: swap the one-time code for the user's identity."""
    body = urllib.parse.urlencode({
        "code": code,
        "client_id": client_id(),
        "client_secret": _client_secret(),
        "redirect_uri": redirect_uri(request),
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        log.warning("Google token exchange failed: %s %s", exc.code, detail)
        if detail == "redirect_uri_mismatch":
            raise AuthError(
                "Google rejected the return address. The URI registered on the "
                "OAuth client has to be exactly {}.".format(redirect_uri(request)))
        raise AuthError("Google wouldn't complete that sign-in. Please try again.")
    except Exception:
        log.exception("Google token exchange failed")
        raise AuthError("We couldn't reach Google just now. Please try again.")

    id_token = payload.get("id_token")
    if not id_token:
        raise AuthError("Google didn't return an identity. Please try again.")
    return _claims_from_id_token(id_token)


def _b64url(segment):
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _claims_from_id_token(id_token):
    """Read the claims out of Google's ID token.

    The signature is not checked, and does not need to be: this token was not
    handed to us by the browser, it came back over TLS from Google's own token
    endpoint in a request authenticated with our client secret. Google document
    exactly this case as not requiring local verification. `aud` and `iss` are
    still checked, because they cost nothing and catch a misconfigured client.
    """
    try:
        claims = json.loads(_b64url(id_token.split(".")[1]).decode("utf-8"))
    except Exception:
        raise AuthError("Google sent an identity we couldn't read. Please try again.")

    if claims.get("aud") != client_id():
        raise AuthError("That sign-in was issued for a different app.")
    if claims.get("iss") not in ISSUERS:
        raise AuthError("That sign-in didn't come from Google.")
    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise AuthError("That Google account has no email address on it.")
    if claims.get("email_verified") is False:
        raise AuthError("Please verify your email with Google first.")
    return {
        "email": email,
        "name": (claims.get("name") or email.split("@")[0]).strip(),
        "picture": (claims.get("picture") or "").strip(),
    }


# --------------------------------------------------------------------------
# The session cookie
# --------------------------------------------------------------------------
def is_admin(email):
    return (email or "").strip().lower() in admin_emails()


def make_session(profile):
    return _serializer("ucxp-session").dumps({
        "email": profile["email"],
        "name": profile.get("name", ""),
        "picture": profile.get("picture", ""),
    })


def read_session(request):
    """The signed-in user, or None. Never raises."""
    if not enabled():
        return None
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    try:
        data = _serializer("ucxp-session").loads(raw, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    email = (data.get("email") or "").strip().lower()
    if not email:
        return None
    # Read the role fresh on every request rather than storing it in the cookie,
    # so removing an address from UCXP_ADMIN_EMAILS takes effect immediately
    # instead of whenever that person's fortnight-long cookie happens to lapse.
    return {
        "email": email,
        "name": data.get("name") or email.split("@")[0],
        "picture": data.get("picture") or "",
        "is_admin": is_admin(email),
    }


def set_session_cookie(response, request, value):
    response.set_cookie(
        SESSION_COOKIE, value,
        max_age=SESSION_MAX_AGE, httponly=True,
        samesite="lax", secure=is_secure(request), path="/")


def clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE, path="/")


def set_state_cookie(response, request, nonce):
    response.set_cookie(
        STATE_COOKIE, nonce,
        max_age=STATE_MAX_AGE, httponly=True,
        samesite="lax", secure=is_secure(request), path="/")


def clear_state_cookie(response):
    response.delete_cookie(STATE_COOKIE, path="/")
