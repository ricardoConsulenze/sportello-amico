"""Vercel entry point: reuses server.py's Handler for /api/* and /demo/*; static/ is served by Vercel.

Without ANTHROPIC_API_KEY (or with MOCK=1) it runs the labelled offline demo, as server.py --mock does."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic  # noqa: E402

from server import Handler  # noqa: E402

_mock = os.environ.get("MOCK") == "1" or not os.environ.get("ANTHROPIC_API_KEY")


class handler(Handler):
    mock = _mock
    client = None if _mock else anthropic.Anthropic()

    def parse_request(self):
        ok = super().parse_request()
        self.path = self.path.split("?", 1)[0]  # Vercel's rewrite appends ?path=…; server.py matches exact paths
        return ok
