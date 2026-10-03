# Sportello Amico: guida al collegamento frontend ↔ backend

Questa guida è per chi sviluppa il **backend Python** e il **chatbot LangGraph** da collegare al frontend
di Sportello Amico. Contiene tutto quello che il frontend invia e si aspetta di ricevere: se il backend
rispetta questi contratti, il collegamento funziona senza toccare il frontend.

**In breve**
- Il frontend chiama 5 route del backend (`/api/status`, `/api/check-medical`, `/api/check-summary`, `/api/check-document`, `/demo/{file}`) e 3 endpoint di LangGraph.
- Tutte le chiamate passano per nginx sulla stessa origine: niente CORS, niente chiavi nel browser.
- Errori sempre come `{"errore": "messaggio in italiano semplice"}`: il frontend lo mostra così com'è all'utente.
- Il backend non salva nulla e non registra contenuti nei log (vedi [Privacy](#7-privacy-requisiti-non-negoziabili)).

---

## 1. Architettura

```
Browser ──► nginx :8080 (container frontend)
              ├─ /               file statici (static/) + config.js generato all'avvio
              ├─ /api/*, /demo/* ──► BACKEND_URL      (Python, oggi server.py :8765)
              └─ /langgraph/*    ──► LANGGRAPH_URL    (LangGraph Agent Server)
                                     solo 3 chiamate, nginx aggiunge x-api-key
```

| Pezzo | Dove | Chi lo possiede |
|---|---|---|
| Connettori del frontend | `static/connectors.js` (`window.Connectors`) | frontend |
| Configurazione pubblica | `static/config.js`, rigenerato da `deploy/frontend/40-app-config.sh` | frontend / ops |
| Proxy, CSP, rate limit | `deploy/frontend/default.conf.template` | ops |
| Backend di riferimento | `server.py`, `rules.py` | backend |
| Avvio completo | `docker-compose.yml`, `.env.example` | ops |

Il backend può essere riscritto (es. FastAPI) liberamente: conta solo che rispetti le route e i JSON qui sotto.

---

## 2. Mappa delle chiamate

| Azione dell'utente | Funzione frontend | Connettore | HTTP | Backend |
|---|---|---|---|---|
| Apertura pagina | `DOMContentLoaded` | `backend.status()` | `GET /api/status` | stato e modalità mock |
| Carica il verbale o il certificato | `receive("medical")` | `backend.checkMedical()` | `POST /api/check-medical` | Claude controlla il documento |
| Carica lo screenshot del Riepilogo | `receiveSummary()` | `backend.checkSummary()` | `POST /api/check-summary` | Claude confronta il riepilogo |
| Carica documento d'identità, foto, delega o nomina, **solo con il consenso** (`S.consent === "check"` o "Fammelo controllare") | `checkDoc(id)` | `backend.checkDocument()` | `POST /api/check-document` | Claude fa solo i controlli sì/no di `DOC_CHECKS` |
| Pulsanti "Esempio" | `loadDemo()` | `backend.demoFile()` | `GET /demo/{file}` | file di `demo_docs/` |
| Scrive o dice una domanda libera | `askChat()` | `chat.ask()` | `POST /langgraph/threads` + `POST /langgraph/threads/{id}/runs/stream` | grafo LangGraph |
| "Cancella tutto" / "Esci" | `resetSession()` | `chat.reset()` | `DELETE /langgraph/threads/{id}` | cancella il thread |

Timeout lato browser: 180 s per i controlli, 10 s per `status`, 15 s per creare il thread.
Timeout nginx verso backend e LangGraph: 300 s.

---

## 3. Contratti del backend

### 3.1 `GET /api/status`
Risposta `200`:
```json
{ "mock": false, "model": "claude-opus-5-5" }
```
`mock: true` mostra in alto la fascia "Modalità dimostrazione senza AI". Se la chiamata fallisce il
frontend continua a funzionare (i passaggi locali non dipendono dal server).

### 3.2 `POST /api/check-medical`
Controlla il documento sanitario (verbale INPS, certificato ASL o del medico curante).

**Richiesta**
```json
{
  "case": { "request_type": "nuovo", "permanent": null },
  "files": [
    { "name": "documento_sanitario.pdf", "media_type": "application/pdf", "data": "<base64 senza prefisso data:>" }
  ]
}
```
| Campo | Valori |
|---|---|
| `case.request_type` | `"nuovo"` (primo rilascio) oppure `"rinnovo"` |
| `case.permanent` | `true`, `false`, `null` (non lo so). Conta solo se `rinnovo` |
| `files[].media_type` | `application/pdf`, `image/jpeg`, `image/png` (le foto vengono già unite in un PDF dal browser) |
| `files[].name` | nome del file; in mock il backend lo usa per scegliere la risposta finta |

Regole da applicare (`rules.py`): `rinnovo` + `permanent: true` → **R6, R5**; tutti gli altri casi → **R4, R5**.

**Risposta `200`**: deve rispettare `MEDICAL_SCHEMA` di `server.py`, più `fonti`.
```json
{
  "tipo_documento": "verbale_invalidita_o_handicap",
  "pagine_viste": [5],
  "pagine_totali_dichiarate": 7,
  "controlli": [
    {
      "regola": "R5",
      "esito": "manca",
      "dove_ho_guardato": "piè di pagina 'Pagina 5 di 7'",
      "spiegazione": "C'è solo la pagina 5 di 7.",
      "cosa_fare": "Scarica dal sito INPS il verbale completo e caricalo tutto in un unico PDF."
    }
  ],
  "esito_generale": "manca_qualcosa",
  "serve_lettera_medico": false,
  "messaggio": "Il riferimento giusto c'è. Mancano però 6 pagine su 7: servono tutte.",
  "fonti": { "R4": "https://…", "R5": "https://…" },
  "mock": false
}
```
| Campo | Valori ammessi | Cosa ci fa il frontend |
|---|---|---|
| `tipo_documento`, `pagine_viste`, `pagine_totali_dichiarate` | tipo: `verbale_invalidita_o_handicap`, `certificato_asl_deambulazione`, `certificato_medico_curante`, `sentenza`, `altro`, `non_leggibile` | oggi non letti dal frontend: tenerli nello schema per controlli futuri e per l'ufficio |
| `controlli[].esito` | `trovato`, `manca`, `non_sicuro` | icona ✅ ❌ ❓; "Cosa fare" mostrato se non `trovato` |
| `controlli[].regola` | `R1`…`R12` | link alla fonte in `fonti[regola]` |
| `esito_generale` | `sembra_completo` → timbro **VA BENE**; `da_verificare` → **DA VERIFICARE**; `manca_qualcosa` → **MANCA LA FRASE** se `serve_lettera_medico`, altrimenti **MANCANO PAGINE** se R5 è `manca`, altrimenti **MANCA QUALCOSA** | timbro sulla busta |
| `serve_lettera_medico` | boolean | mostra "Preparami la lettera per il medico" |
| `messaggio` | 2–4 frasi semplici | primo fumetto della risposta |
| `fonti` | `{ "R4": url, … }` per le regole controllate | scheda per l'ufficio |
| `mock` | opzionale, `true` solo per risposte finte | — |

Tutti i campi tranne `fonti` e `mock` sono **obbligatori**: se ne manca uno l'interfaccia si rompe.

### 3.3 `POST /api/check-summary`
"Prova generale": confronta lo screenshot del Riepilogo del modulo del Comune con la situazione dichiarata.

**Richiesta**
```json
{
  "context": {
    "role_label": "delegato",
    "request_label": "primo rilascio",
    "can_go_out": "no, è difficile",
    "car": "sì, vuole associare la targa",
    "medical_outcome": "manca_qualcosa"
  },
  "files": [
    { "name": "riepilogo.jpg", "media_type": "image/jpeg", "data": "<base64>" }
  ]
}
```
| Campo | Valori inviati |
|---|---|
| `role_label` | `persona con disabilità`, `genitore di persona minorenne`, `delegato`, `legale rappresentante della persona con disabilità` |
| `request_label` | `primo rilascio`, `rinnovo` |
| `can_go_out` | `sì`, `no, è difficile` |
| `car` | `sì, vuole associare la targa`, `no o più avanti` |
| `medical_outcome` | un valore di `esito_generale` oppure `non fatto` |

Il contesto non contiene dati personali: la targa non viene mai inviata.

**Risposta `200`**: `SUMMARY_SCHEMA`
```json
{
  "problemi": [
    {
      "scheda": "7. Targa",
      "gravita": "blocca",
      "problema": "Hai indicato una targa ma non hai scelto se aderire alla Piattaforma CUDE.",
      "cosa_fare": "Nella scheda 7 scegli una delle due opzioni sulla Piattaforma.",
      "regola": "R12"
    }
  ],
  "pronto_per_inoltro": false,
  "messaggio": "Ho guardato il riepilogo. C'è una cosa da sistemare."
}
```
`gravita`: `blocca` (🛑, timbro DA SISTEMARE) oppure `attenzione` (⚠️). Con `pronto_per_inoltro: true` e
`problemi: []` il frontend passa a "Conferma e Inoltra".

### 3.3 bis `POST /api/check-document`
Parte solo se la persona ha accettato: il frontend lo chiede una volta ("🔎 Sì, controllali" / "🔒 No, restano qui")
e dalla scheda del foglio si può chiedere il controllo di un singolo documento.
```json
{ "kind": "id_front" | "id_back" | "photo" | "delega" | "nomina",
  "files": [ { "name": "fototessera_35x45.jpg", "media_type": "image/jpeg", "data": "<base64>" } ] }
```
Un solo file. `kind` sconosciuto o numero di file diverso da 1 → `400`. I controlli vengono da `DOC_CHECKS`
in `rules.py` (regole R2/R3; la scadenza del documento non si controlla perché il modulo non la chiede).
Risposta `200`, con la stessa forma di `check-medical` così il frontend riusa timbri, passi ed esito:
```json
{ "tipo_riconosciuto": "carta_identita|passaporto|patente|fototessera|delega|atto_di_nomina|altro|non_leggibile",
  "controlli": [ { "controllo": "firma", "esito": "trovato|manca|non_sicuro", "dove_ho_guardato": "in fondo al foglio",
                   "spiegazione": "", "cosa_fare": "", "regola": "R3", "etichetta": "C'è la firma di chi delega." } ],
  "esito_generale": "sembra_completo|manca_qualcosa|da_verificare", "messaggio": "",
  "fonti": { "R3": "<fonte>" } }
```
Il server tiene solo i controlli previsti, nel loro ordine: un controllo mancante diventa `non_sicuro` e
un `manca` porta sempre a `manca_qualcosa`. Timbri: `DOC_STAMP` in app.js (es. MANCA LA FIRMA, LATO SBAGLIATO).
In MOCK tutto passa, tranne una delega il cui nome contiene `senza_firma`.

### 3.4 `GET /demo/{file}`
Restituisce il file da `demo_docs/` con il suo `Content-Type`; `404` con `{"errore": "Non trovato."}` se
non esiste. Il backend deve impedire il path traversal (`../`). Serve solo per la demo: in produzione
si può disattivare, e i pulsanti "Esempio" mostreranno l'errore.

### 3.5 Errori
Formato unico, per tutte le route: `{"errore": "<frase in italiano semplice, con cosa fare>"}`.

| Status | Quando | Esempio di `errore` |
|---|---|---|
| `400` | JSON non valido; corpo che non è un oggetto; `case`/`context` non oggetti; `files` non lista di oggetti con `name`/`media_type`/`data` stringhe; formato file non ammesso; base64 non valido; nessun file | `Richiesta non valida.` · `Formato non accettato: image/heic` |
| `404` | route o file demo inesistente | `Non trovato.` |
| `413` | corpo oltre 30 MB (lo blocca prima nginx) | `File troppo grandi. Ogni file deve stare sotto i 5 MB.` |
| `500` | errore inatteso del backend (nel log solo il tipo di errore) | `Qualcosa non ha funzionato. Riprova.` |
| `429` | rate limit di nginx (6 controlli al minuto per IP, burst 4; chat 30 al minuto) | `Troppe richieste in poco tempo. Aspetta un minuto e riprova.` (risponde nginx) |
| `502` | Claude non disponibile, rifiuto, risposta troncata | `Il controllo automatico non è disponibile. Riprova più tardi.` |
| `502`/`504` da nginx | backend spento o irraggiungibile | `Il servizio non risponde in questo momento. Riprova tra poco.` |

Il frontend mostra `errore` all'utente e propone "Riprova": niente stack trace, niente codici tecnici.

### 3.6 Limiti da tenere allineati
| Limite | Backend | nginx | Frontend |
|---|---|---|---|
| Dimensione corpo | `MAX_BODY = 30 MB` | `client_max_body_size 30m` | file singolo ≤ 5 MB (regola R9) |
| Tempo di risposta | — | `proxy_read_timeout 300s` | `requestTimeoutMs: 180000` |
| Formati | `ALLOWED_MEDIA` | — | HEIC convertito in JPG nel browser |

---

## 4. Contratto del chatbot LangGraph

Il frontend parla con l'**Agent Server** di LangGraph (API standard di LangGraph Platform o `langgraph dev`/`langgraph up`).

### 4.1 Le 3 chiamate
```
POST   /threads                          body: {"metadata": {"app": "sportello-amico"}}  → {"thread_id": "<uuid>", …}
POST   /threads/{thread_id}/runs/stream  body: vedi sotto                                → text/event-stream
DELETE /threads/{thread_id}                                                               → 204
```
Il thread viene creato alla prima domanda e cancellato con "Cancella tutto" o "Esci".
nginx blocca qualsiasi altro endpoint (`/threads/search`, `/assistants`, `/store`…): esporli
permetterebbe di leggere le conversazioni di altre persone.

### 4.2 Corpo della run
```json
{
  "assistant_id": "sportello",
  "input": { "messages": [ { "role": "user", "content": "Quanto tempo ci vuole per avere il pass?" } ] },
  "config": {
    "configurable": {
      "sportello": {
        "stage": "desk",
        "tab": 1,
        "role": "delegate",
        "request": "nuovo",
        "permanent": null,
        "medical_outcome": "manca_qualcosa"
      }
    }
  },
  "stream_mode": ["messages-tuple"],
  "multitask_strategy": "interrupt"
}
```
| Campo di `sportello` | Valori |
|---|---|
| `stage` | `welcome` (accoglienza), `desk` (documenti sul tavolo), `guide` (accompagnamento nel modulo), `done` (inviata) |
| `tab` | 1–10, schermata del modulo del Comune su cui si trova la persona |
| `role` | `self`, `parent`, `delegate`, `legal`, oppure `null` |
| `request` | `nuovo`, `rinnovo`, `null` |
| `permanent` | `true`, `false`, `null` |
| `medical_outcome` | `sembra_completo`, `manca_qualcosa`, `da_verificare`, `null` |

Il frontend manda **solo il nuovo messaggio**: la cronologia la tiene il thread lato server.

### 4.3 Cosa legge il frontend dallo stream
Eventi SSE con `stream_mode: messages-tuple`:
```
event: metadata
data: {"run_id": "…"}

event: messages
data: [{"type": "AIMessageChunk", "content": "Il Comune ", …}, {"langgraph_node": "agent", …}]

event: messages
data: [{"type": "AIMessageChunk", "content": "risponde entro 30 giorni.", …}, {…}]

event: end
```
- Mostra il testo di ogni chunk con `type` = `AIMessageChunk` o `ai`; `content` può essere una stringa o una lista di blocchi `{"type": "text", "text": "…"}`.
- Ignora i messaggi di altri tipi (tool, human). **Attenzione**: se il grafo ha più nodi LLM (es. un classificatore), anche i loro token arrivano al browser. Marca quei modelli con il tag `nostream` o filtra per `langgraph_node` nel grafo.
- `event: error` → il frontend mostra "Lo sportello non riesce a rispondere ora. Riprova."
- Testo semplice: il frontend fa l'escape di tutto, il Markdown non viene interpretato. Paragrafi separati da una riga vuota.

### 4.4 Grafo minimo compatibile
`langgraph.json`
```json
{
  "dependencies": ["."],
  "graphs": { "sportello": "./graph.py:graph" },
  "env": ".env"
}
```
`graph.py`
```python
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import START, MessagesState, StateGraph

from rules import RULES  # stesse regole del backend: unica fonte di verità

llm = ChatAnthropic(model="claude-opus-5-5", max_tokens=1024)

SYSTEM = """Sei lo Sportello Amico del Comune di Milano per il pass disabili (CUDE).
Rispondi in italiano semplice, frasi brevi, tono gentile. Ogni risposta dice cosa fare.
Non dire mai che la persona ha o non ha diritto al pass: decide l'ufficio.
Non chiedere e non ripetere nomi, codici fiscali, targhe o diagnosi.
Se non sei sicuro, rimanda all'ufficio: 02 884 52909, MTA.Uffdisabili@comune.milano.it.
Regole ufficiali:
{rules}
Situazione della persona (senza dati personali): {ctx}"""


def agent(state: MessagesState, config: RunnableConfig):
    ctx = config.get("configurable", {}).get("sportello", {})
    rules = "\n".join(f"{k}: {text}" for k, (text, _src) in RULES.items())
    prompt = [SystemMessage(SYSTEM.format(rules=rules, ctx=ctx))] + state["messages"]
    return {"messages": [llm.invoke(prompt)]}


graph = StateGraph(MessagesState).add_node("agent", agent).add_edge(START, "agent").compile()
```
Avvio in sviluppo: `langgraph dev` (porta 2024). In produzione: `langgraph build -t sportello-langgraph`
e decommenta i servizi `langgraph`, `redis`, `postgres` in `docker-compose.yml`.

---

## 4bis. Dati dell'ufficio (OFFICE)
La funzione "Vado di persona" usa la costante `OFFICE` in `static/app.js`: indirizzo, orari, telefono,
email, centralino e mezzi per l'Unità Gestione Permessi di via Sile 8. Se il chatbot LangGraph deve
rispondere su ufficio, orari o contatti, usi **gli stessi valori** (per esempio un tool `office_info` che
li restituisce fissi) invece di generarli. Orari e canale di prenotazione vanno confermati con il Comune.

## 5. Configurazione

### Frontend (container nginx)
| Variabile | Esempio | Effetto |
|---|---|---|
| `BACKEND_URL` | `http://backend:8765` | origine del backend, senza slash finale |
| `LANGGRAPH_URL` | `http://langgraph:8000`, `https://xxx.langgraph.app` | origine dell'Agent Server, **senza path**. Vuota = chat nascosta |
| `LANGGRAPH_API_KEY` | `lsv2_…` | aggiunta da nginx come header `x-api-key`; mai visibile nel browser |
| `LANGGRAPH_ASSISTANT_ID` | `sportello` | nome del grafo in `langgraph.json` o id dell'assistant |
| `APP_ENV` | `production` | scritto in `config.js` |
| `API_BASE_URL`, `CSP_CONNECT_EXTRA` | `https://api.esempio.it` | solo se il backend è su un altro dominio senza proxy |

### Backend
| Variabile | Effetto |
|---|---|
| `ANTHROPIC_API_KEY` | obbligatoria se non in mock |
| `MOCK=1` | risposte finte, segnalate nella UI |
| `HOST`, `PORT` | `0.0.0.0` / `8765` nel container |
| `ALLOWED_ORIGINS` | lista separata da virgole, solo per frontend su altro dominio (CORS) |

`config.js` è pubblico: non metterci mai chiavi.

---

## 6. Sviluppo e test

```bash
cp .env.example .env                       # ANTHROPIC_API_KEY oppure MOCK=1
docker compose up --build -d               # http://localhost:8080
.claude/skills/collegamento-fe-be/smoke_test.sh http://localhost:8080
```

Prove rapide con curl:
```bash
curl -s localhost:8080/api/status
B64=$(base64 < demo_docs/C_verbale_completo_fittizio.pdf | tr -d '\n')
curl -s localhost:8080/api/check-medical -H 'Content-Type: application/json' \
  -d "{\"case\":{\"request_type\":\"nuovo\",\"permanent\":null},\"files\":[{\"name\":\"C.pdf\",\"media_type\":\"application/pdf\",\"data\":\"$B64\"}]}"

# chat (con LANGGRAPH_URL impostato)
TID=$(curl -s -X POST localhost:8080/langgraph/threads -H 'Content-Type: application/json' -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["thread_id"])')
curl -N -X POST localhost:8080/langgraph/threads/$TID/runs/stream -H 'Content-Type: application/json' \
  -d '{"assistant_id":"sportello","input":{"messages":[{"role":"user","content":"Quanto dura il pass?"}]},"stream_mode":["messages-tuple"]}'
curl -s -X DELETE localhost:8080/langgraph/threads/$TID
```

Casi di prova attesi (pulsanti "Esempio" nell'app):

| Caso | File | Risultato atteso |
|---|---|---|
| A | `A_lucia_verbale_solo_pagina5.pdf` | MANCANO PAGINE, art. 381 trovato |
| B | `B_giorgio_certificato_generico.png` (rinnovo permanente) | MANCA LA FRASE + lettera per il medico |
| B2 | `B2_giorgio_certificato_corretto.png` | VA BENE |
| C | `C_verbale_completo_fittizio.pdf` | VA BENE |
| D | `D_lucia_riepilogo_modulo.png` | 3 problemi: retro documento, Piattaforma CUDE, ritiro di persona |

---

## 7. Privacy: requisiti non negoziabili

1. **Nessuna conservazione**: i file arrivano in memoria, vanno a Claude e vengono scartati alla fine della richiesta. Niente disco, niente database.
2. **Log senza contenuti**: solo metodo, path e status. Niente corpi, niente query string, niente testo della chat.
3. **Dati minimi**: al backend arrivano sempre il documento sanitario e lo screenshot del riepilogo. Documento d'identità, foto, delega e nomina solo se la persona accetta il controllo; altrimenti restano nel browser. La targa non lascia mai il browser.
4. **Prompt**: Claude non trascrive nomi, codici fiscali, date, targhe o diagnosi; il testo dei documenti è un dato, mai un'istruzione.
5. **Nessuna decisione**: mai "hai diritto". Decide l'ufficio del Comune.
6. **Chat**: i thread si cancellano su richiesta (`DELETE`); configurare anche una scadenza automatica dei thread sull'Agent Server.

Dettagli in [PRIVACY.md](../PRIVACY.md).

---

## 8. Checklist del collegamento

- [ ] `GET /api/status` risponde e `mock` è quello atteso
- [ ] le risposte di `check-medical` e `check-summary` hanno **tutti** i campi obbligatori, con i valori ammessi
- [ ] gli errori sono sempre `{"errore": "…"}` in italiano semplice, con lo status giusto
- [ ] limiti allineati: 30 MB, 300 s
- [ ] `LANGGRAPH_URL` senza path; il grafo si chiama come `LANGGRAPH_ASSISTANT_ID`; lo stato ha `messages`
- [ ] nello stream arrivano solo i token della risposta finale
- [ ] `DELETE /threads/{id}` funziona
- [ ] log del backend e di LangGraph senza contenuti
- [ ] smoke test verde e verifica dell'agente `integration-checker`
