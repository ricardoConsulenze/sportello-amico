import pytest

import rules
from rules import PHRASE_R6, RULES, rules_for, rules_text


@pytest.mark.parametrize("request_type,permanent,expected", [
    ("nuovo", None, ["R4", "R5"]),
    ("nuovo", True, ["R4", "R5"]),
    ("nuovo", False, ["R4", "R5"]),
    ("rinnovo", True, ["R6", "R5"]),
    ("rinnovo", False, ["R4", "R5"]),
    ("rinnovo", None, ["R4", "R5"]),
])
def test_rules_for(request_type, permanent, expected):
    assert rules_for(request_type, permanent) == expected


def test_rules_text_includes_ids_and_text():
    out = rules_text(["R4", "R5"])
    lines = out.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("R4: ") and RULES["R4"][0] in lines[0]
    assert lines[1].startswith("R5: ") and RULES["R5"][0] in lines[1]


def test_every_rule_has_text_and_https_source():
    assert RULES
    for rid, (text, source) in RULES.items():
        assert rid.startswith("R")
        assert isinstance(text, str) and text.strip(), rid
        assert source.startswith("https://"), rid


def test_phrase_r6_non_empty_and_in_rule():
    assert PHRASE_R6.strip()
    assert PHRASE_R6 in RULES["R6"][0]
