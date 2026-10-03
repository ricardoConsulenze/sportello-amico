# Documenti demo per i tester di Sportello Amico

**Dati inventati o campioni pubblici anonimizzati.** Tutti i file generati sono inventati: nomi (ESEMPIO PERSONA, Anna/Lucia/Samira Esempio), codice fiscale `XXXXXX00X00X000X`, numero documento `FAC000000`, e ogni immagine riporta "FAC-SIMILE · DOCUMENTO DI PROVA". Fanno eccezione i verbali **01** e **05** (e `demo_docs/C_verbale_esempio_art381.pdf`, `demo_docs/C2_verbale_esempio_L382.pdf`): sono i **verbali di esempio anonimizzati (OMISSIS) pubblicati dal Comune di Milano** nel modulo online CUDE (https://formshd.comune.milano.it/rwe2/module_preview.jsp?MODULE_TAG=PASS_DISABILI), senza dati anagrafici. Non aggiungere mai documenti reali.

In modalità mock il nome del file conta solo per i pulsanti "Esempio" dell'app: un file caricato a mano (documento sanitario o riepilogo) viene inviato con un nome generico, per non mandare al server nomi di persona.

Formati: PDF, JPG o PNG, tutti sotto i 5 MB.
Rigenerare i file: `uv run --with pillow --with pypdf python documenti-demo/genera_documenti_demo.py` (dalla cartella del progetto).

**Cosa esce dal dispositivo:** solo il **documento sanitario** (casella "Verbale INPS" / "Certificato del medico o verbale") e la **schermata del riepilogo** vanno al backend, dove li legge Claude. Tutti gli altri file restano nel browser.

## Tabella dei file

| File | Casella in cui caricarlo | Persona / ruolo | Risultato atteso | Va al backend? |
|---|---|---|---|---|
| `01_lucia_verbale_INCOMPLETO_pag5di7.pdf` | Verbale INPS | Lucia (delegata, primo rilascio) | MANCANO PAGINE (c'è solo la pag. 5 di 7); riferimento art. 381 trovato | **Sì** |
| `02_verbale_COMPLETO_3pagine.pdf` | Verbale INPS | Lucia o Samira | VA BENE: 3 pagine su 3, art. 381, esonero dalle revisioni | **Sì** |
| `03_giorgio_certificato_SENZA_frase.png` | Certificato del medico o verbale | Giorgio (rinnovo, pass permanente) | MANCA LA FRASE (R6) e lettera per il medico | **Sì** |
| `04_giorgio_certificato_corretto_CON_frase.png` | Certificato del medico o verbale | Giorgio | VA BENE: la frase R6 c'è | **Sì** |
| `05_verbale_L382_non_vedente.pdf` | Verbale INPS | Lucia o Samira | Riconosce lo status di non vedente (L. 382/70) | **Sì** |
| `50_verbale_foto_pag1di3.jpg` + `pag2di3` + `pag3di3` | Verbale INPS (selezionare **le 3 foto insieme**) | Lucia o Samira | L'app le unisce in un unico PDF ("Ho unito le 3 foto"), poi VA BENE | **Sì** (come PDF unico) |
| `06_lucia_riepilogo_modulo_CON_ERRORI.png` | Schermata del riepilogo (prova generale) | Lucia | Problemi: manca il retro del documento, manca la scelta sulla Piattaforma CUDE, ritiro di persona se Lucia ha detto che la mamma non può uscire | **Sì** |
| `07_schermata_modulo_SENZA_errori.png` | Schermata del riepilogo (prova generale) | Lucia | Nessun problema: "Mi sembra tutto a posto" | **Sì** |
| `10_anna_titolare_documento_FRONTE_ok.jpg` | Documento di chi ha il pass, fronte | Lucia (Anna è la titolare); per Giorgio va bene come suo documento | ✅ Pronto | No |
| `11_anna_titolare_documento_RETRO_ok.jpg` | Documento di chi ha il pass, retro | come sopra | ✅ Pronto | No |
| `12_anna_titolare_documento_FRONTE_TAGLIATO.jpg` | Documento, fronte | qualsiasi | Un angolo è fuori dalla foto. L'app **non** lo controlla da sola: si vede nell'anteprima e nell'esempio "Un angolo è tagliato fuori". L'ufficio lo rifiuterebbe | No |
| `13_anna_titolare_documento_FRONTE_SFOCATO.jpg` | Documento, fronte | qualsiasi | Scritte illeggibili. Nessun controllo automatico: va giudicato a occhio | No |
| `14_lucia_richiedente_documento_FRONTE_ok.jpg` | Il tuo documento, fronte | Lucia (richiedente); va bene anche per Samira | ✅ Pronto | No |
| `15_lucia_richiedente_documento_RETRO_ok.jpg` | Il tuo documento, retro | Lucia / Samira | ✅ Pronto | No |
| `20_fototessera_COLORI_ok.jpg` | Fototessera | qualsiasi | ✅ "Ho tagliato la foto nella misura giusta (35×45 mm)" | No |
| `21_fototessera_BIANCO_NERO.jpg` | Fototessera | qualsiasi | ⚠️ "La foto sembra in bianco e nero: il Comune la vuole a colori" | No |
| `22_fototessera_SELFIE_con_sfondo.jpg` | Fototessera | qualsiasi | Viene ritagliata a 35×45 ma resta lo sfondo di casa: nessun avviso automatico, va giudicata a occhio | No |
| `30_delega_FIRMATA.pdf` | Delega firmata | Lucia | ✅ Pronto | No |
| `31_delega_NON_firmata.pdf` | Delega firmata | Lucia | L'app la accetta (non legge la firma): serve a verificare che il tester se ne accorga nell'anteprima. L'ufficio la rifiuterebbe | No |
| `40_samira_decreto_nomina_COMPLETO_2pagine.pdf` | Decreto di nomina | Samira (amministratrice di sostegno) | ✅ Pronto | No |
| `41_samira_decreto_nomina_SOLO_pagina2.pdf` | Decreto di nomina | Samira | L'app lo accetta (non controlla le pagine del decreto): manca la pagina con la nomina, l'ufficio lo rifiuterebbe | No |

## Tre scenari completi

**1. Lucia, delegata dalla mamma Anna, primo rilascio**
Scegli: "Per un familiare o un amico" (con la sua delega) → primo rilascio; alla domanda se la mamma può uscire rispondi "no".
1. Verbale INPS: `01_lucia_verbale_INCOMPLETO_pag5di7.pdf` → MANCANO PAGINE. Poi riprova con `02_verbale_COMPLETO_3pagine.pdf` (o con le 3 foto `50_...`) → VA BENE.
2. Documento di chi ha il pass: `10_...FRONTE_ok.jpg`, `11_...RETRO_ok.jpg` (prova prima `12_...TAGLIATO` o `13_...SFOCATO`).
3. Fototessera: `21_fototessera_BIANCO_NERO.jpg` (avviso), poi `20_fototessera_COLORI_ok.jpg`.
4. Il tuo documento: `14_...` e `15_...`.
5. Delega: `31_delega_NON_firmata.pdf`, poi `30_delega_FIRMATA.pdf`.
6. Prova generale: `06_lucia_riepilogo_modulo_CON_ERRORI.png` (problemi), poi `07_schermata_modulo_SENZA_errori.png`.

**2. Giorgio, rinnovo del suo pass permanente**
Scegli: "Per me" → rinnovo → pass permanente.
1. Certificato del medico: `03_giorgio_certificato_SENZA_frase.png` → MANCA LA FRASE e lettera per il medico; poi `04_giorgio_certificato_corretto_CON_frase.png` → VA BENE.
2. Documento di identità: `10_...` e `11_...` (i dati sono finti, il nome stampato non conta).
3. Fototessera: `22_fototessera_SELFIE_con_sfondo.jpg`, poi `20_fototessera_COLORI_ok.jpg`.
4. Prova generale: `07_schermata_modulo_SENZA_errori.png`.

**3. Samira, amministratrice di sostegno, primo rilascio**
Scegli: "Sono tutore o amministratore di sostegno" → primo rilascio.
1. Verbale INPS: `05_verbale_L382_non_vedente.pdf` (oppure le 3 foto `50_...` selezionate insieme).
2. Documento di chi ha il pass: `10_...` e `11_...`.
3. Fototessera: `20_fototessera_COLORI_ok.jpg`.
4. Il tuo documento: `14_...` e `15_...`.
5. Decreto di nomina: `41_samira_decreto_nomina_SOLO_pagina2.pdf`, poi `40_samira_decreto_nomina_COMPLETO_2pagine.pdf`.
6. Prova generale: `07_schermata_modulo_SENZA_errori.png`.

## Modalità MOCK=1 e chiave reale

**Con una vera `ANTHROPIC_API_KEY`** Claude legge davvero i file: i risultati attesi della tabella vengono dal contenuto dei documenti.

**Con `MOCK=1`** il backend non chiama Claude e risponde con esiti preconfezionati scelti **dal nome del file** che riceve (`mock_medical` e `mock_summary` in `server.py`):

- Documento sanitario (`mock_medical`), nell'ordine:
  1. il nome contiene `giorgio` ma non `corretto` → MANCA LA FRASE (R6) e lettera per il medico;
  2. il nome contiene `esempio` o `lucia` → MANCANO PAGINE (pagina 5 di 7, art. 381 trovato);
  3. qualsiasi altro nome → VA BENE (3 pagine su 3).
- Riepilogo (`mock_summary`): il nome contiene `riepilogo` → 2 problemi bloccanti (retro del documento, scelta CUDE). Inoltre, se nel percorso hai risposto che il titolare **non** può uscire, si aggiunge l'avviso sul ritiro di persona. Senza `riepilogo` nel nome e con "può uscire" = sì → nessun problema.

**Attenzione, in MOCK il nome conta solo in questi casi:**
- **Schermata del riepilogo:** l'app manda al backend il nome originale del file, quindi `06_lucia_riepilogo_...` dà i problemi e `07_schermata_modulo_SENZA_errori.png` (di proposito senza la parola "riepilogo") non li dà.
- **Documento sanitario:** se lo carichi tu dalla cartella, l'app lo rinomina in `documento_sanitario.pdf` prima di inviarlo. Quindi in MOCK **ogni verbale o certificato caricato a mano dà VA BENE**, qualunque sia il nome. I tre esiti diversi in MOCK si vedono solo con i pulsanti "Esempio: ..." dentro l'app, che inviano i nomi originali di `demo_docs/`. I nomi in questa cartella sono comunque coerenti con le regole: `03_giorgio_...` → manca la frase, `04_giorgio_certificato_corretto_...` → va bene, `01_lucia_...` → mancano pagine.
