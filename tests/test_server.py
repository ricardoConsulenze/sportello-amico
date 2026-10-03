import base64
import http.client
import json
import threading
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

import pytest

import server
from server import (MEDICAL_SCHEMA, SUMMARY_SCHEMA, ClaudeError, ask_claude, content_blocks,
                    mock_medical, mock_summary)

TINY_PDF = base64.b64encode(b"%PDF-1.4\n%%EOF\n").decode()
TINY_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()
TINY_JPG = base64.b64encode(b"\xff\xd8\xff\xe0").decode()


# --- tiny schema checker: required keys, no extra keys, enums, basic types -------------------------

_TYPES = {"string": str, "integer": int, "boolean": bool, "array": list, "object": dict}


def validate(obj, schema, path="$"):
    t = schema.get("type")
    if t:
        assert isinstance(obj, _TYPES[t]), f"{path}: expected {t}, got {type(obj).__name__}"
        if t == "integer":
            assert not isinstance(obj, bool), path
    if "enum" in schema:
        assert obj in schema["enum"], f"{path}: {obj!r} not in {schema['enum']}"
    if t == "object":
        for k in schema.get("required", []):
            assert k in obj, f"{path}: missing {k}"
        props = schema.get("properties", {})
        for k, v in obj.items():
            if k in props:
                validate(v, props[k], f"{path}.{k}")
    if t == "array" and "items" in schema:
        for i, item in enumerate(obj):
            validate(item, schema["items"], f"{path}[{i}]")


def strip_extras(result, extras=("fonti", "mock")):
    # the server adds these after the model call; they are not part of the model schema
    return {k: v for k, v in result.items() if k not in extras}


def test_validator_catches_bad_enum():
    with pytest.raises(AssertionError):
        validate({"problemi": [], "pronto_per_inoltro": True, "messaggio": 1}, SUMMARY_SCHEMA)


# --- content_blocks -------------------------------------------------------------------------------

@pytest.mark.parametrize("media,data,kind", [
    ("application/pdf", TINY_PDF, "document"),
    ("image/jpeg", TINY_JPG, "image"),
    ("image/png", TINY_PNG, "image"),
])
def test_content_blocks_accepts(media, data, kind):
    blocks = content_blocks([{"media_type": media, "data": data, "name": "x"}])
    assert blocks == [{"type": kind, "source": {"type": "base64", "media_type": media, "data": data}}]


@pytest.mark.parametrize("media", ["image/gif", "text/plain", None, "application/zip"])
def test_content_blocks_rejects_media(media):
    with pytest.raises(ValueError):
        content_blocks([{"media_type": media, "data": TINY_PDF}])


def test_content_blocks_rejects_bad_base64():
    with pytest.raises(ValueError, match="File non valido"):
        content_blocks([{"media_type": "application/pdf", "data": "not base64!!"}])


def test_content_blocks_rejects_empty():
    with pytest.raises(ValueError, match="Nessun file"):
        content_blocks([])


# --- mock_medical / mock_summary -----------------------------------------------------------------

def _files(*names):
    return {"files": [{"name": n, "media_type": "application/pdf", "data": TINY_PDF} for n in names]}


def test_mock_medical_giorgio():
    r = mock_medical(_files("Certificato_Giorgio.pdf"))
    assert r["esito_generale"] == "manca_qualcosa"
    assert r["serve_lettera_medico"] is True


def test_mock_medical_giorgio_corretto():
    r = mock_medical(_files("certificato_giorgio_corretto.pdf"))
    assert not (r["esito_generale"] == "manca_qualcosa" and r["serve_lettera_medico"])
    assert r["serve_lettera_medico"] is False


@pytest.mark.parametrize("name", ["verbale_lucia.pdf", "ESEMPIO.pdf"])
def test_mock_medical_lucia_esempio(name):
    r = mock_medical(_files(name))
    r5 = [c for c in r["controlli"] if c["regola"] == "R5"]
    assert r5 and r5[0]["esito"] == "manca"
    assert r["esito_generale"] == "manca_qualcosa"


def test_mock_medical_other():
    r = mock_medical(_files("documento.pdf"))
    assert r["esito_generale"] == "sembra_completo"


def test_mock_medical_no_files():
    assert mock_medical({})["esito_generale"] == "sembra_completo"


@pytest.mark.parametrize("names", [("giorgio.pdf",), ("giorgio_corretto.pdf",), ("lucia.pdf",), ("altro.pdf",)])
def test_mock_medical_matches_schema(names):
    r = mock_medical(_files(*names))
    assert r["mock"] is True
    validate(strip_extras(r), MEDICAL_SCHEMA)
    assert set(strip_extras(r)) <= set(MEDICAL_SCHEMA["properties"])
    assert set(r["fonti"]) == {c["regola"] for c in r["controlli"]}
    assert all(u.startswith("https://") for u in r["fonti"].values())


def test_mock_summary_problems():
    body = _files("Riepilogo_domanda.png")
    body["context"] = {"can_go_out": "no, non può uscire"}
    r = mock_summary(body)
    gravita_enum = SUMMARY_SCHEMA["properties"]["problemi"]["items"]["properties"]["gravita"]["enum"]
    assert len(r["problemi"]) == 3
    assert all(p["gravita"] in gravita_enum for p in r["problemi"])
    assert {p["regola"] for p in r["problemi"]} == {"R2", "R12", "R8"}
    assert r["pronto_per_inoltro"] is False
    validate(strip_extras(r), SUMMARY_SCHEMA)


def test_mock_summary_clean():
    body = _files("foto.png")
    body["context"] = {"can_go_out": "sì"}
    r = mock_summary(body)
    assert r["problemi"] == [] and r["pronto_per_inoltro"] is True
    validate(strip_extras(r), SUMMARY_SCHEMA)


# --- ask_claude with a fake client ----------------------------------------------------------------

def _fake_client(response):
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return response

    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create))), calls


def test_ask_claude_refusal_raises():
    client, calls = _fake_client(SimpleNamespace(stop_reason="refusal", content=[]))
    with pytest.raises(ClaudeError):
        ask_claude(client, "sys", [{"type": "text", "text": "x"}], MEDICAL_SCHEMA)
    assert calls and calls[0]["model"] == server.MODEL


def test_ask_claude_max_tokens_raises():
    client, _ = _fake_client(SimpleNamespace(stop_reason="max_tokens", content=[]))
    with pytest.raises(ClaudeError):
        ask_claude(client, "sys", [], SUMMARY_SCHEMA)


def test_ask_claude_no_text_raises():
    client, _ = _fake_client(SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="thinking")]))
    with pytest.raises(ClaudeError):
        ask_claude(client, "sys", [], SUMMARY_SCHEMA)


def test_ask_claude_parses_json():
    payload = {"problemi": [], "pronto_per_inoltro": True, "messaggio": "ok"}
    client, calls = _fake_client(SimpleNamespace(
        stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(payload))]))
    assert ask_claude(client, "sys", [], SUMMARY_SCHEMA) == payload
    assert calls[0]["output_config"]["format"]["schema"] is SUMMARY_SCHEMA


# --- HTTP layer in mock mode ----------------------------------------------------------------------

@pytest.fixture(scope="module")
def srv():
    mp = pytest.MonkeyPatch()
    mp.setattr(server.Handler, "mock", True)
    mp.setattr(server.Handler, "client", None)
    mp.setattr(server.Handler, "log_message", lambda *a, **k: None)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    t = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    t.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()
    mp.undo()


def request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        hdrs = {"Content-Type": "application/json"}
        hdrs.update(headers or {})
        conn.request(method, path, body=body, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        ctype = resp.getheader("Content-Type", "")
        data = json.loads(raw) if ctype.startswith("application/json") else raw
        return resp.status, data
    finally:
        conn.close()


def test_status(srv):
    status, data = request(srv, "GET", "/api/status")
    assert status == 200
    assert data["mock"] is True and data["model"] == server.MODEL


def test_post_invalid_json(srv):
    status, data = request(srv, "POST", "/api/check-medical", "{not json")
    assert status == 400 and "errore" in data


@pytest.mark.parametrize("body", [[], {"files": "x"}, {"files": [1]}, {"case": "x", "files": []}])
def test_post_bad_shape(srv, body):
    status, data = request(srv, "POST", "/api/check-medical", body)
    assert status == 400 and "errore" in data


def test_post_mock_skips_file_validation(srv):
    # mock mode does not run content_blocks: even a bad media type gets a canned answer
    status, data = request(srv, "POST", "/api/check-medical",
                           {"files": [{"name": "a.gif", "media_type": "image/gif", "data": "!!"}]})
    assert status == 200 and data["mock"] is True


def test_post_valid_pdf(srv):
    body = {"case": {"request_type": "nuovo"},
            "files": [{"name": "verbale.pdf", "media_type": "application/pdf", "data": TINY_PDF}]}
    status, data = request(srv, "POST", "/api/check-medical", body)
    assert status == 200
    assert data["esito_generale"] in MEDICAL_SCHEMA["properties"]["esito_generale"]["enum"]
    assert data["mock"] is True


def test_post_summary(srv):
    body = {"context": {"can_go_out": "no"},
            "files": [{"name": "riepilogo.png", "media_type": "image/png", "data": TINY_PNG}]}
    status, data = request(srv, "POST", "/api/check-summary", body)
    assert status == 200 and data["pronto_per_inoltro"] is False


def test_post_unknown_route(srv):
    status, data = request(srv, "POST", "/api/nope", {"files": []})
    assert status == 404 and "errore" in data


def test_get_unknown_route(srv):
    status, _ = request(srv, "GET", "/does-not-exist.html")
    assert status == 404


@pytest.mark.parametrize("path", ["/demo/../server.py", "/demo/..%2Fserver.py", "/demo/../../etc/passwd"])
def test_demo_path_traversal(srv, path):
    status, data = request(srv, "GET", path)
    assert status == 404
    assert b"import anthropic" not in (data if isinstance(data, bytes) else json.dumps(data).encode())


def test_body_too_large(srv, monkeypatch):
    monkeypatch.setattr(server, "MAX_BODY", 10)
    status, data = request(srv, "POST", "/api/check-medical", b"x" * 100)
    assert status == 413 and "errore" in data
