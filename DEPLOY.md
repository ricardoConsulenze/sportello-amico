# Messa in produzione

```
browser ──► nginx (frontend, :8080) ──► /api, /demo   ──► backend Python (server.py, :8765) ──► Claude
                 │ static/ + config.js   └► /langgraph ──► LangGraph Agent Server (chatbot)
```

Il browser parla solo con la propria origine: nginx fa da reverse proxy, aggiunge la chiave LangGraph
lato server e applica CSP, rate limit e log senza contenuti.

## Avvio locale identico alla produzione
```bash
cp .env.example .env          # imposta ANTHROPIC_API_KEY, oppure MOCK=1
docker compose up --build -d  # http://localhost:8080
.claude/skills/collegamento-fe-be/smoke_test.sh http://localhost:8080
```

## Variabili d'ambiente
| Variabile | Servizio | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | backend | obbligatoria se `MOCK=0` |
| `MOCK` | backend | `1` = risposte preimpostate, segnalate nella UI |
| `ALLOWED_ORIGINS` | backend | solo se il frontend è su un altro dominio senza proxy |
| `BACKEND_URL` | frontend | origine del backend, es. `http://backend:8765` |
| `LANGGRAPH_URL` | frontend | origine dell'Agent Server, senza path. Vuota = chat nascosta |
| `LANGGRAPH_API_KEY` | frontend | inviata da nginx come `x-api-key`, mai al browser |
| `LANGGRAPH_ASSISTANT_ID` | frontend | id o nome del grafo (default `sportello`) |
| `API_BASE_URL`, `CSP_CONNECT_EXTRA` | frontend | solo per backend su un altro dominio |

`static/config.js` viene rigenerato all'avvio del container da `deploy/frontend/40-app-config.sh`:
è pubblico, non metterci segreti.

## Connettori (frontend)
Tutta la rete passa da `static/connectors.js`:
- `Connectors.backend`: `status()`, `checkMedical()`, `checkSummary()`, `demoFile()`
- `Connectors.chat`: `ask(text, context)` (generatore di testo in streaming SSE), `cancel()`, `reset()`

Contratto LangGraph atteso dal frontend:
- grafo con stato `messages` (es. `MessagesState`), registrato con l'id `LANGGRAPH_ASSISTANT_ID`;
- input `{"messages": [{"role": "user", "content": "..."}]}`, streaming `messages-tuple`;
- contesto non personale in `config["configurable"]["sportello"]` (`stage`, `tab`, `role`, `request`, `permanent`, `medical_outcome`);
- nginx espone solo `POST /threads`, `POST /threads/{id}/runs/stream`, `DELETE /threads/{id}`.
  "Cancella tutto" cancella il thread sul server.

Dettagli e ricette: skill `collegamento-fe-be`.

## Prima del rilascio
- [ ] HTTPS davanti a nginx (load balancer o piattaforma); HSTS è già impostato
- [ ] `ANTHROPIC_API_KEY` e `LANGGRAPH_API_KEY` nel secret manager della piattaforma, non in `.env`
- [ ] Accordi privacy, DPIA e retention con Anthropic e con chi ospita LangGraph (vedi PRIVACY.md)
- [ ] smoke test verde e verifica dell'agente `integration-checker`
