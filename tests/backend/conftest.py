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

SIGN_IN_VARS = (
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "UCXP_SESSION_SECRET",
    "UCXP_ADMIN_EMAILS",
    "UCXP_REQUIRE_AUTH",
    "UCXP_AUTH_BASE_URL",
)


@pytest.fixture(autouse=True)
def _no_ambient_sign_in(monkeypatch):
    for name in SIGN_IN_VARS:
        monkeypatch.delenv(name, raising=False)
