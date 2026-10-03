#!/usr/bin/env bash
# Smoke test del collegamento frontend (nginx) <-> backend (server.py) <-> LangGraph.
# Uso:  .claude/skills/collegamento-fe-be/smoke_test.sh [BASE_URL]   (default http://localhost:8080)
# Nota: /api/* ha un rate limit (6 req/min, burst 4): lo script fa al massimo 2 POST su /api.
set -euo pipefail

BASE=${1:-http://localhost:8080}
BASE=${BASE%/}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAIL=0

ok()   { echo "✅ $*"; }
ko()   { echo "❌ $*"; FAIL=1; }
skip() { echo "⏭️  $*"; }

# http METHOD PATH [curl args...] -> stampa lo status code, body in $TMP/body, header in $TMP/head
http() {
  local method=$1 path=$2 code; shift 2
  : > "$TMP/body"; : > "$TMP/head"; : > "$TMP/err"
  code=$(curl -sS -o "$TMP/body" -D "$TMP/head" -w '%{http_code}' --max-time 30 -X "$method" "$@" "$BASE$path" 2>"$TMP/err") || true
  echo "${code:-000}"
}

echo "Smoke test su $BASE"

# 1. healthz
code=$(http GET /healthz)
[ "$code" = 200 ] && ok "/healthz 200" || ko "/healthz -> $code $(cat "$TMP/err")"

# 2. /api/status
code=$(http GET /api/status)
if [ "$code" = 200 ] && grep -q '"mock"' "$TMP/body"; then
  ok "/api/status 200 con chiave \"mock\": $(cat "$TMP/body")"
else
  ko "/api/status -> $code $(head -c 200 "$TMP/body")"
fi
MOCK=false
grep -Eq '"mock"[[:space:]]*:[[:space:]]*true' "$TMP/body" 2>/dev/null && MOCK=true

# 3. /config.js pubblico e senza segreti
code=$(http GET /config.js)
cp "$TMP/body" "$TMP/config.js"
if [ "$code" = 200 ] && grep -q 'APP_CONFIG' "$TMP/config.js"; then
  ok "/config.js 200 con APP_CONFIG"
else
  ko "/config.js -> $code, APP_CONFIG assente"
fi
if [ "$code" != 200 ]; then
  ko "/config.js non letto: impossibile verificare i segreti"
elif grep -Eiq '(^|[^a-z])sk-|api_key|apikey|x-api-key' "$TMP/config.js"; then
  ko "/config.js contiene qualcosa che sembra un segreto"
else
  ok "/config.js senza segreti"
fi
CHAT=false
grep -Eq 'enabled:[[:space:]]*true' "$TMP/config.js" && CHAT=true

# 4. header di sicurezza su /
code=$(http GET /)
[ "$code" = 200 ] || ko "/ -> $code"
for h in Content-Security-Policy X-Frame-Options X-Content-Type-Options; do
  grep -qi "^$h:" "$TMP/head" && ok "header $h presente su /" || ko "header $h mancante su /"
done

# 5. file demo servito dal backend via /demo/
code=$(http GET /demo/D_lucia_riepilogo_modulo.png)
[ "$code" = 200 ] && ok "/demo/D_lucia_riepilogo_modulo.png 200" || ko "/demo/D_lucia_riepilogo_modulo.png -> $code"

# 6. JSON non valido -> 400 con {"errore": ...}
code=$(http POST /api/check-medical -H 'Content-Type: application/json' --data-binary '{non json')
if [ "$code" = 400 ] && grep -q '"errore"' "$TMP/body"; then
  ok "POST /api/check-medical JSON non valido -> 400 $(cat "$TMP/body")"
elif [ "$code" = 429 ]; then
  ko "POST /api/check-medical -> 429 (rate limit: aspetta un minuto e riprova)"
else
  ko "POST /api/check-medical JSON non valido -> $code $(head -c 200 "$TMP/body")"
fi

# 7. controllo documento con un PDF minuscolo (solo in MOCK: in produzione costerebbe una chiamata a Claude)
if [ "$MOCK" = true ]; then
  PDF_B64=$(printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' | base64 | tr -d '\n')
  printf '{"case":{"request_type":"nuovo","permanent":null},"files":[{"name":"smoke_test.pdf","media_type":"application/pdf","data":"%s"}]}' "$PDF_B64" > "$TMP/req.json"
  code=$(http POST /api/check-medical -H 'Content-Type: application/json' --data-binary "@$TMP/req.json")
  if [ "$code" = 200 ] && grep -q '"esito_generale"' "$TMP/body"; then
    ok "POST /api/check-medical (PDF, mock) -> 200 con esito_generale"
  elif [ "$code" = 429 ]; then
    ko "POST /api/check-medical -> 429 (rate limit: aspetta un minuto e riprova)"
  else
    ko "POST /api/check-medical (PDF, mock) -> $code $(head -c 200 "$TMP/body")"
  fi
else
  skip "POST /api/check-medical con PDF saltato (backend non in MOCK: chiamerebbe Claude)"
fi

# 8. endpoint privati di LangGraph mai esposti
for req in "GET /langgraph/assistants" "POST /langgraph/threads/search" "GET /langgraph/threads"; do
  set -- $req
  code=$(http "$1" "$2" -H 'Content-Type: application/json' $([ "$1" = POST ] && echo "--data-binary {}"))
  case "$code" in
    403|404|405) ok "$req -> $code (privato)" ;;
    000) ko "$req -> nessuna risposta dal server" ;;
    *) ko "$req -> $code: endpoint privato esposto!" ;;
  esac
done

# 9. chat attiva: crea un thread e lo cancella subito (privacy)
if [ "$CHAT" = true ]; then
  code=$(http POST /langgraph/threads -H 'Content-Type: application/json' --data-binary '{"metadata":{"app":"sportello-amico","smoke_test":true}}')
  TID=$(grep -Eo '"thread_id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{36}"' "$TMP/body" | grep -Eo '[0-9a-fA-F-]{36}' || true)
  if [ "$code" = 200 ] && [ -n "$TID" ]; then
    ok "POST /langgraph/threads -> thread_id $TID"
    code=$(http DELETE "/langgraph/threads/$TID")
    case "$code" in 200|202|204) ok "DELETE /langgraph/threads/{id} -> $code" ;; *) ko "DELETE /langgraph/threads/{id} -> $code" ;; esac
  else
    ko "POST /langgraph/threads -> $code $(head -c 200 "$TMP/body")"
  fi
else
  skip "chat LangGraph disattivata in config.js: test dei thread saltato"
fi

echo
if [ "$FAIL" = 0 ]; then echo "Tutto collegato correttamente."; else echo "Ci sono controlli falliti."; fi
exit "$FAIL"
