"""Keep the developer's own `.env` out of the test run.

`Dashboard.backend.main` loads the repo-root `.env` at import so local runs
actually get their credentials. That is right for `run.sh` and wrong for pytest:
the moment a real GOOGLE_CLIENT_SECRET lands in that file, sign-in switches on
for the whole suite and dozens of tests that never mention auth start failing
with 401s.

So every test starts from "sign-in is not configured", and the handful that
need it switched on say so themselves via the `configured` fixture.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import order matters here. `main` calls envfile.load() at import, and it is
# normally first imported inside a test's own fixture -- i.e. *after* the
# fixture below has cleared these names, so .env quietly puts them straight
# back and that one test sees a configured server. Doing the import here, at
# collection, means the load has already happened before any test runs and the
# fixture's delete is the last word.
from Dashboard.backend import main  # noqa: E402,F401

SIGN_IN_VARS = (
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "UCXP_SESSION_SECRET",
    "UCXP_ADMIN_EMAILS",
    "UCXP_REQUIRE_AUTH",
    "UCXP_AUTH_BASE_URL",
)

# Same argument, sharper consequence: with these set, a test that activates a
# business would write a row into the real shared Supabase project that the
# runtime reads. A test suite must not be able to publish a fake merchant.
SUPABASE_VARS = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "UCXP_SUPABASE_TIMEOUT",
)


@pytest.fixture(autouse=True)
def _no_ambient_sign_in(monkeypatch):
    for name in SIGN_IN_VARS + SUPABASE_VARS:
        monkeypatch.delenv(name, raising=False)
