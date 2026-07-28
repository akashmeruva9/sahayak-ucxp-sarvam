"""Load the repo-root `.env` into the process environment.

Local runs get their secrets from `.env`, but nothing ever put that file into
`os.environ` -- `run.sh` starts uvicorn without sourcing it, so every
`os.environ.get` in the backend saw nothing and each caller that cared grew its
own file-reading fallback. One loader, called once at startup, replaces that.

A real environment variable always wins. On a host there is no `.env` at all and
this is a no-op, so nothing here can override what Railway sets.
"""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load(path=None):
    """Populate os.environ from `.env`. Returns the names that were set."""
    path = path or os.path.join(ROOT, ".env")
    applied = []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return applied

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # `export FOO=bar` is valid in a file people also source by hand.
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        name, sep, value = line.partition("=")
        name = name.strip()
        if not sep or not name:
            continue
        # Quotes are decoration in a .env and a 403 when sent verbatim to an
        # upstream API, so they come off here rather than at each call site.
        value = value.strip().strip("'\"")
        if name not in os.environ:
            os.environ[name] = value
            applied.append(name)
    return applied
