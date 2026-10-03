---
name: collegamento-fe-be
description: Usa questa skill quando aggiungi o modifichi un endpoint, un metodo di window.Connectors, un contratto API (JSON di richiesta/risposta), una variabile d'ambiente, una regola proxy di nginx o l'integrazione della chat LangGraph, oppure quando devi verificare che frontend e backend di Sportello Amico siano collegati correttamente.
---

# Collegamento frontend ↔ backend (Sportello Amico)

```
browser ──► nginx (container frontend :8080: file statici + reverse proxy)
              ├─ /api/*, /demo/*  ──► server.py (container backend :8765)
              └─ /langgraph/*     ──► LangGraph Agent Server (solo 3 chiamate; nginx aggiunge x-api-key)
```

- `static/config.js` viene **rigenerato all'avvio del container** da `deploy/frontend/40-app-config.sh` a partire dalle env var. Il file nel repo serve solo per lo sviluppo locale (`python server.py`).
- Il frontend fa chiamate di rete **solo** tramite `window.Connectors` (`static/connectors.js`). `app.js` non chiama mai `fetch`.

## 1. Mappa del collegamento

| Funzione in app.js | Connector | Route HTTP | Location nginx | Handler / endpoint |
|---|---|---|---|---|
| avvio (`DOMContentLoaded`) → banner MOCK | `backend.status()` (timeout 10 s) | `GET /api/status` | `location = /api/status` (senza rate limit) | `do_GET` → `{"mock","model"}` |
| `receive("medical")` | `backend.checkMedical(p)` | `POST /api/check-medical` | `location /api/` (zona `checks` 6 r/min burst 4, 30m, read 300s) | `do_POST` → `check_medical` / `mock_medical` |
| `receiveSummary()` | `backend.checkSummary(p)` | `POST /api/check-summary` | `location /api/` | `do_POST` → `check_summary` / `mock_summary` |
| `loadDemo()` | `backend.demoFile(name)` → Blob | `GET /demo/{name}` | `location /demo/` | `_demo_file` (solo file in `demo_docs/`) |
| `askChat()` | `chat.ask(text, chatContext())` (async generator di delta) | `POST /threads` (1ª volta), poi `POST /threads/{uuid}/runs/stream` (SSE) | `= /langgraph/threads`, `~ …/runs/stream$` (zona `chat` 30 r/min) | Agent Server: create thread / run stream |
| nuova domanda | `chat.cancel()` | interrompe il fetch in corso | – | `multitask_strategy: "interrupt"` |
| `resetSession()` ("Cancella tutto", logout) | `chat.reset()` | `DELETE /threads/{uuid}` | `~ /langgraph/threads/{uuid}$` (solo DELETE) | Agent Server: delete thread |
| – | – | qualsiasi altro `/langgraph/*` | `location /langgraph/ { return 404; }` | **mai esposto** |

Le regole `/langgraph/*` sono generate da `40-app-config.sh` in `/etc/nginx/snippets/langgraph.conf`. Se `LANGGRAPH_URL` è vuota c'è solo `return 404` e `chat.enabled` è `false`.

## 2. Contratti API

**`GET /api/status`** → `200 {"mock": bool, "model": "claude-opus-5-5"}`

**`POST /api/check-medical`**
```json
{ "case": { "request_type": "nuovo" | "rinnovo", "permanent": true | false | null },
  "files": [ { "name": "x.pdf", "media_type": "application/pdf" | "image/jpeg" | "image/png", "data": "<base64 senza prefisso data:>" } ] }
```
Risposta `200`, secondo `MEDICAL_SCHEMA` più alcuni campi aggiunti:
```json
{ "tipo_documento": "verbale_invalidita_o_handicap|certificato_asl_deambulazione|certificato_medico_curante|sentenza|altro|non_leggibile",
  "pagine_viste": [int], "pagine_totali_dichiarate": int,
  "controlli": [ { "regola": "R4", "esito": "trovato|manca|non_sicuro", "dove_ho_guardato": "", "spiegazione": "", "cosa_fare": "" } ],
  "esito_generale": "sembra_completo|manca_qualcosa|da_verificare",
  "serve_lettera_medico": bool, "messaggio": "2-4 frasi",
  "fonti": { "R4": "<fonte>" },   // aggiunto dal server
  "mock": true }                  // solo in MOCK
```

**`POST /api/check-summary`**
```json
{ "context": { "role_label": "", "request_label": "rinnovo|primo rilascio", "can_go_out": "sì|no, è difficile",
               "car": "", "medical_outcome": "<esito_generale>|non fatto" },
  "files": [ { "name", "media_type", "data" } ] }
```
Risposta `200`, secondo `SUMMARY_SCHEMA`: `{ "problemi": [ { "scheda", "gravita": "blocca|attenzione", "problema", "cosa_fare", "regola" } ], "pronto_per_inoltro": bool, "messaggio": "" }` (+ `"mock": true`).

**Errori**: sempre `{"errore": "<frase in italiano semplice>"}`. `connectors.js` mostra `errore` così com'è.
| Status | Quando |
|---|---|
| 400 | JSON non valido, formato file non accettato, base64 non valido, nessun file |
| 404 | route o file demo inesistente |
| 413 | body > `MAX_BODY` (server.py) o > `client_max_body_size` (nginx; in quel caso la pagina non è JSON e il connector usa "File troppo grandi.") |
| 429 | rate limit nginx (corpo non JSON, il connector usa il messaggio generico) |
| 502 | `ClaudeError`: rate limit, API giù, refusal, max_tokens |

**LangGraph**
- `POST /threads` con body `{"metadata": {"app": "sportello-amico"}}` → `{"thread_id": "<uuid>"}`.
- `POST /threads/{id}/runs/stream`:
  ```json
  { "assistant_id": "<LANGGRAPH_ASSISTANT_ID>",
    "input": { "messages": [ { "role": "user", "content": "..." } ] },
    "config": { "configurable": { "sportello": { "stage", "tab", "role", "request", "permanent", "medical_outcome" } } },
    "stream_mode": ["messages-tuple"], "multitask_strategy": "interrupt" }
  ```
  Risposta SSE: `event: messages`, `data: [messageChunk, metadata]`. Vengono mostrati solo i chunk con `type` `AIMessageChunk` o `ai` (il `content` può essere una stringa o una lista di blocchi `{type:"text"}`). `event: error` diventa un errore in italiano.
- In `sportello` c'è **solo lo stato non personale** dello sportello: niente nomi, documenti, targa o CF.
- Il grafo deve avere nello stato la chiave `messages` (es. `MessagesState`).

## 3. Ricetta: aggiungere un nuovo endpoint

1. **server.py**: aggiungi la route in `do_POST` (dizionario `routes`, coppia `(reale, mock)`) o in `do_GET`. Scrivi sempre anche la versione mock con `"mock": True`. Gli input non validi lanciano `ValueError` (diventa 400), gli errori di Claude lanciano `ClaudeError` (diventa 502). Se la risposta è strutturata, definisci uno schema `*_SCHEMA`.
2. **connectors.js**: aggiungi un metodo a `backend`, ad es. `checkX(p) { return backend.post("/api/check-x", p); }`. Se la chiamata deve essere breve, passa un timeout esplicito.
3. **app.js**: chiama solo `Connectors.backend.checkX(...)` dentro un `try/catch` e mostra `e.message`.
4. **nginx** (`default.conf.template`): sotto `/api/` non serve nulla. Per un **nuovo prefisso** aggiungi una `location` con `limit_req`, `client_max_body_size` e `proxy_read_timeout`, e aggiungi il prefisso alla `map $cache_control`.
5. **Rate limit**: le chiamate costose stanno nella zona `checks`. Se la nuova chiamata è frequente ed economica, usa una location esatta come `= /api/status`.
6. **CSP**: se il browser deve raggiungere un'origine esterna, aggiungila a `CSP_CONNECT_EXTRA` (`connect-src`). Se il frontend è su un altro dominio, servono anche `API_BASE_URL` e `ALLOWED_ORIGINS`.
7. **Env var nuove**: aggiornale in `.env.example`, `docker-compose.yml` e nell'`ENV` del Dockerfile giusto. Se sono pubbliche, aggiungile a `40-app-config.sh`.
8. Aggiorna **la mappa e i contratti** di questa skill.
9. Aggiungi un controllo a `smoke_test.sh` ed eseguilo.

## 4. Ricetta: collegare il grafo LangGraph

1. Nel repo del grafo: `langgraph.json` → `{"graphs": {"sportello": "./graph.py:graph"}, "dependencies": ["."], "env": ".env"}`. La chiave deve coincidere con `LANGGRAPH_ASSISTANT_ID`.
2. Grafo basato su `MessagesState`; il contesto si legge così:
   ```python
   def agente(state: MessagesState, config: RunnableConfig):
       ctx = config["configurable"].get("sportello", {})   # stage, role, request, permanent, medical_outcome
       ...
       return {"messages": [risposta]}
   ```
3. Build: `langgraph build -t sportello-langgraph`. Poi decommenta i servizi `langgraph`, `redis` e `postgres` in `docker-compose.yml`.
4. In `.env`: `LANGGRAPH_URL=http://langgraph:8000` (oppure `https://<deployment>.langgraph.app`), `LANGGRAPH_API_KEY=...` (solo su LangGraph Platform; nginx lo aggiunge lato server) e `LANGGRAPH_ASSISTANT_ID=sportello`.
5. `docker compose up --build`. A quel punto `config.js` deve contenere `enabled: true` e lo smoke test crea e cancella un thread.
6. Privacy: il thread vive solo in memoria nel browser e viene cancellato con `DELETE` a ogni "Cancella tutto" o logout. Non abilitare store o cron e non esporre altri endpoint dell'Agent Server.

## 5. Regole

- **Nessun `fetch`/`XMLHttpRequest`/`EventSource` fuori da `connectors.js`**. Controllo: `grep -n "fetch(" static/*.js` deve trovare solo `connectors.js`.
- **Nessun segreto in `config.js`**: è pubblico. Le chiavi stanno nelle env del container (`ANTHROPIC_API_KEY` nel backend, `LANGGRAPH_API_KEY` in nginx).
- **Errori sempre in italiano semplice**, senza dettagli tecnici. Il server logga solo lo status, mai il contenuto.
- **Timeout**: connector 180 s (`requestTimeoutMs`), status 10 s, creazione thread 15 s, DELETE 10 s; nginx `proxy_read_timeout 300s`. Se i tempi del backend crescono, il timeout del client deve restare ≤ a quello di nginx.
- **Limite del body 30 MB**, coerente in due punti: `client_max_body_size 30m` (nginx `/api/`) e `MAX_BODY` (server.py). Se ne cambi uno, cambia anche l'altro. Per LangGraph il limite è 64k.
- **Log di privacy**: nginx usa `log_format privacy` (metodo, `$uri` senza query string, status, tempo) e server.py usa `log_message` (metodo, path, status). Niente body e niente query string.
- Dentro una `location` non usare `add_header`: farebbe sparire gli header di sicurezza. Per la cache usa la `map $cache_control`.

## 6. Verifica

```bash
docker compose up --build -d
.claude/skills/collegamento-fe-be/smoke_test.sh                    # default http://localhost:8080
.claude/skills/collegamento-fe-be/smoke_test.sh https://staging.example.it
```
Lo script controlla:
- `/healthz`, `/api/status`, `config.js` (senza segreti), header di sicurezza e file demo;
- la risposta 400 a un JSON non valido;
- `check-medical` con un PDF minuscolo, **solo in MOCK**;
- che gli endpoint privati `/langgraph/*` rispondano 404/403;
- se la chat è attiva, la creazione e la cancellazione di un thread.

Termina con un codice diverso da zero se un controllo fallisce. Fa al massimo 2 POST su `/api` per restare nel burst del rate limit: se esegui lo script più volte di seguito e ricevi 429, aspetta un minuto.
