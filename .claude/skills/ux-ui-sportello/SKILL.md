---
name: ux-ui-sportello
description: Regole UX/UI, accessibilità, responsive, microcopy, contenuti e privacy del frontend di Sportello Amico (static/). Usala per QUALSIASI modifica a interfaccia, testi, layout, stili, componenti, contenuti informativi o accessibilità di static/index.html, style.css, app.js, connectors.js, config.js.
---

# UX/UI di Sportello Amico

Frontend vanilla in `static/` (niente build, niente framework). Metafora: a sinistra lo **sportello**
(chat `#chat` con pulsanti grandi `.chip`, 🎤 risposta a voce, 🔊 lettura ad alta voce); a destra il
**tavolo di legno** (`#table`) con la **busta** e i fogli `.doc` timbrati (`.stamp`): VA BENE,
MANCANO PAGINE, MANCA LA FRASE, DA VERIFICARE. Leggi i file prima di cambiarli e riusa ciò che c'è.

## 1. Principi
- **Pubblico:** anziani, persone con mobilità ridotta, familiari con delega. Progetta per chi ha
  vista debole, mani poco ferme e poca pratica digitale.
- **Una domanda alla volta.** Lo sportello fa **al massimo 3 domande** in tutto. Risposte con chip, non con testo libero.
- **Bersagli grandi:** chip 56px, CTA 60px, microfono 64px. Mai sotto 44px.
- **Italiano semplice:** frasi brevi (max ~20 parole), una idea per frase, niente burocratese non spiegato.
- **Mai colpevolizzare.** Il problema è del documento, non della persona.
- **Ogni problema dice cosa fare** (azione concreta + chi contattare se serve).
- **Mai "hai diritto".** Noi controlliamo che la domanda sia completa; **decide l'ufficio del Comune**.
- **Trasparenza AI:** il messaggio di benvenuto dice che il documento sanitario lo legge Claude,
  un'intelligenza artificiale. Non toglierlo. In modalità mock resta visibile `#mock-banner`.

## 2. Design token e componenti (in `style.css`)
**Variabili `:root`** (uniche fonti di colore; un colore nuovo va aggiunto qui, con nome, e verificato a 4.5:1):
`--red #a50e2b` · `--red-dark #7a0a20` · `--ink #1b1d21` · `--muted #555b63` · `--wood` / `--wood-dark` ·
`--paper #fffdf8` · `--kraft` / `--kraft-dark` · `--ok #18733a` · `--warn #9a6200` · `--bad #b3121e` ·
`--bubble #fff` · `--me #fde9ec` · `--focus #1a5fd0`. Base `font-size: 20px` su `:root`; `html.large` = 25px.
Usa sempre `rem` per testo e spaziature legate al testo, così la modalità A+ scala tutto.

**Componenti da riusare:**
| Classe | Uso |
|---|---|
| `.msg` / `.msg.me` / `.bubble` / `.face` | messaggi in chat (creati da `addMsg()` / `bot()` in app.js) |
| `.chips` + `.chip` / `.chip.soft` / `.chip small` | risposte; `.soft` per azioni secondarie |
| `.mic`, `.mic.listening`, `.mic-hint` | input vocale |
| `.inline-input`, `.ask` | campi brevi dentro la chat (targa, domanda libera) |
| `.envelope` (`.sealed`, `.label`, `.seal`), `.slots` | la busta |
| `.doc.empty` / `.doc.filled`, `.icon`, `.name`, `.hint`, `.scan` | fogli documento (sono `<button>`) |
| `.stamp.ok` / `.stamp.warn` / `.stamp.bad` | timbri; testo MAIUSCOLO corto (max 3 parole) |
| `.replica` (`.r-field`, `.r-btn`, `.hot`, `.hand`), `.callout`, `.guide-nav` | guida al modulo del Comune |
| `dialog#sheet`, `.sheet-head`, `.sheet-body` | fogli modali (delega, lettera, scheda ufficio) |
| `.cta` / `.cta.ghost`, `.info`, `.promise`, `.persona`, `.small`, `.disclaimer`, `.sr-only` | home, login, note |
Non creare varianti nuove se una esistente basta. Il colore non è mai l'unico segnale: il timbro ha sempre testo.

## 3. Accessibilità (WCAG 2.2 AA) – checklist
- [ ] Contrasto testo ≥ 4.5:1 (≥ 3:1 per testo grande e bordi dei controlli). Attenzione a `--muted` su `--wood`.
- [ ] Bersagli ≥ 44×44px (preferire 56+), spaziati di almeno 8px.
- [ ] Focus visibile: non rimuovere `:focus-visible { outline: 4px solid var(--focus) }`. Hover e focus hanno lo stesso stile.
- [ ] `#chat` resta `role="log" aria-live="polite"`: i nuovi messaggi si annunciano. Non usare `assertive`.
- [ ] Ogni input ha `<label>` (anche `.sr-only`) o `aria-label`; i bottoni solo-emoji hanno `aria-label`; emoji decorative `aria-hidden="true"`.
- [ ] I `.doc` hanno `aria-label` con nome + stato ("…: VA BENE"). Aggiornalo quando cambia il timbro.
- [ ] Tutto usabile da tastiera (Tab, Invio, Spazio, Esc chiude `#sheet`); ordine logico; focus spostato sul nuovo campo quando serve.
- [ ] Toggle con `aria-pressed` (`#btn-voice`, `#btn-size`).
- [ ] Nuove animazioni rispettano `prefers-reduced-motion` (regola globale già presente: non aggirarla con JS).
- [ ] Modalità **A+** (`html.large`): nessun testo tagliato, niente sovrapposizioni, chip che vanno a capo.
- [ ] 320px di larghezza senza scroll orizzontale (anche con A+), zoom 200% ok.
- [ ] 🎤 e 🔊 continuano a funzionare: i testi nuovi passano da `bot()`/`addMsg()` (che chiama `speak()`) e i chip
      hanno etichette pronunciabili e distinte (il riconoscimento vocale confronta le parole).

## 4. Responsive
Breakpoint reali in `style.css`:
- `≤ 900px`: `.room` passa a una colonna; `.counter` e `.table` perdono `max-height` (scroll di pagina, non interno).
  **Nota:** `.table { order: -1 }` mette il **tavolo sopra e la chat sotto** sui telefoni. Se si vuole
  "chat sopra, busta sotto", va cambiato questo `order` e verificato che il focus segua l'ordine visivo.
- `≤ 800px`: `.hero` a una colonna, `.hero-art` nascosta.
- Griglie fluide: `.info-grid` `minmax(300px,1fr)`, `.promise-row` 220px, `.slots` 150px.
  Rischio noto: a 320px `.info-grid` (300px + padding 16px) può sforare: preferisci `minmax(min(300px,100%),1fr)`.
  Anche `.envelope .label` (`white-space: nowrap`) può sforare con A+.
- Scrivi CSS mobile-first quando aggiungi regole; niente larghezze fisse in px su contenitori.
- `dialog#sheet` (`width: calc(100% - 24px)`) e la `.replica` devono restare leggibili e chiudibili su telefono;
  le `.r-field label` al 38% vanno controllate a 320px.
- Header: `.tools` va a capo; con login fatto ci sono 4–5 bottoni: verificare che non coprano il contenuto.
- Controlla **320 / 375 / 768 / 1024 / 1440px**, anche **telefono in orizzontale** (altezza ~360px:
  chip e 🎤 raggiungibili, dialog scorrevole), con la modalità responsive del browser **e A+ attivo insieme**.

## 5. Microcopy
Tu informale, verbi all'imperativo gentile, numeri in cifre, termini fissi.
| ✅ Sì | ❌ No |
|---|---|
| "Mancano le pagine 1–4 e 6–7. Scansiona tutte le pagine in un unico PDF." | "Documento non valido." |
| "Al medico serve questa frase esatta. Ti preparo la lettera da stampare." | "Hai caricato il certificato sbagliato." |
| "Non sono sicuro. Fallo vedere all'ufficio: 📞 02 884 52909." | "Errore di elaborazione (422)." |
| "La domanda sembra completa. Decide l'ufficio del Comune." | "Hai diritto al pass!" |
| "Connessione assente. Controlla internet e riprova." | "Network error" |
| "Vuoi farlo ora?" [Sì, adesso] [Più tardi] | "Si desidera procedere con il caricamento?" |
Timbri: MAIUSCOLO, 1–3 parole (VA BENE, MANCANO PAGINE, MANCA LA FRASE, DA VERIFICARE, DA RIPROVARE).
Messaggi lunghi: più bolle brevi (`bot(p1, p2)`), non una bolla lunga.

## 6. Contenuti
- **`rules.py` è la fonte unica** (R1–R12, ognuna con fonte `FORM` o `PAGE`). Se cambia una regola,
  aggiorna **prima `rules.py`**, poi home (`index.html`), messaggi in `app.js` e README, citando la fonte ufficiale.
- La home deve coincidere con `rules.py` e con le fonti del README: chi può fare domanda (R1), allegati (R2/R3),
  verbale e PDF unico (R4/R5), frase del medico (R6, `PHRASE_R6`), 5 anni (R7), consegna non modificabile (R8),
  formati e 5 MB (R9), proroga/duplicato via chiamata (R10), targa e piattaforma CUDE (R12).
- Controlla a ogni modifica: link (aprono, `target="_blank" rel="noopener"`), date e anni ("nel 2025, in media 30"),
  indirizzo (Via Sile 8), orari, 📞 02 884 52909, ✉️ MTA.Uffdisabili@comune.milano.it, ☎️ 020202.
- Termini coerenti: **pass** nel testo, **CUDE** solo come sigla tecnica (prima volta spiegata); **verbale**
  (INPS), **certificato** (medico/ASL), **delega**, **Comune**, **ufficio**. Non mescolare "contrassegno"/"permesso".
- Sempre italiano semplice; nessun dato reale nelle demo (solo FAC-SIMILE e campioni pubblici del Comune).

## 7. Privacy nell'interfaccia
- Mai chiedere nomi, codici fiscali, date di nascita o targhe in testo libero verso il server.
  I dati della delega e la targa restano nel browser (vedi PRIVACY.md).
- Ogni campo libero mostra l'avviso nel placeholder: "(non scrivere nomi o codici fiscali)".
- Prima di uno screenshot del riepilogo, invita a coprire nome e codice fiscale.
- **"Cancella tutto"** (`#btn-wipe`) deve restare sempre visibile dentro lo sportello (in app.js: `$("btn-wipe").hidden = !inside`);
  "Esci" cancella tutto. Non spostarli in menu nascosti.
- Dire sempre cosa resta sul dispositivo e cosa va a Claude (solo documento sanitario e riepilogo).

## 8. Vincoli tecnici
- Niente framework, bundler, CDN o font esterni. Librerie solo in `static/vendor/`.
- CSP: `script-src 'self' 'unsafe-eval' blob:` → **niente script inline, niente `onclick=`/`on*` negli attributi**:
  usa `addEventListener` (o delega su `data-*`). Per stampare: finestra senza script (vedi `w.print()` in app.js).
- Ogni dato dinamico va passato a `esc()` prima di `innerHTML` (anche testi da Claude, nomi file, errori).
- Rete solo tramite `window.Connectors` (`Connectors.backend.*`, `Connectors.chat.*`); mai `fetch` diretto in app.js.
- Configurazione in `config.js` (pubblico: niente segreti).

## 9. Come verificare una modifica
1. Avvia: `MOCK=1 docker compose up --build` → http://localhost:8080, oppure `python server.py --mock` → http://localhost:8765.
2. Percorso completo: home → "Inizia" → persona → 3 domande → caricamento → guida al modulo → prova generale → Cancella tutto.
3. Casi demo (pulsanti "Esempio"): **A** verbale pag. 5 di 7 → MANCANO PAGINE; **B** certificato generico →
   MANCA LA FRASE + lettera; **B2** certificato con frase → VA BENE; **C** verbale completo → VA BENE;
   **D** screenshot riepilogo → 3 problemi (retro documento, scelta CUDE, ritiro di persona).
4. Ripeti con **A+** attivo, a **320px** e in orizzontale, **solo tastiera**, con 🔊 attivo e un tentativo 🎤 (Chrome).
5. Console del browser senza errori CSP; screen reader (VoiceOver) legge i nuovi messaggi in chat.
