# Knowledge base

Testi ufficiali che l'assistente usa per rispondere alle domande (`/api/ask`) e per le regole di validazione.

- Un file Markdown per ogni pagina sorgente, con il testo copiato fedelmente.
- Nel frontmatter: `id`, `titolo`, `fonte` (URL), `ente`, `scaricato` (data). La fonte viene mostrata all'utente come citazione.
- Niente riassunti o interpretazioni qui: quelli vanno nei prompt o in `rules.py`. Eccezione: una sezione finale intitolata "Nota nostra", chiaramente separata dal testo ufficiale.
- PDF originali in `allegati/`.

## Gerarchia delle fonti

**La fonte di verità è la pagina del modulo online CUDE** ([`modulo-cude-presentazione.md`](modulo-cude-presentazione.md)).

1. Se un'altra fonte (FAQ, pagina del servizio, `docs/`) dice qualcosa di diverso, vale il modulo.
2. Le altre fonti servono solo ad aggiungere dettagli che il modulo non dà (es. misura 35x45 della fototessera, contatti, orari).
3. Un documento che il modulo non elenca non va chiesto come obbligatorio.

## Fonti

| File | Fonte | Scaricato |
|---|---|---|
| [modulo-cude-presentazione.md](modulo-cude-presentazione.md) | **Fonte di verità.** [Modulo online CUDE, presentazione](https://formshd2.comune.milano.it/rwe2/module_preview.jsp?MODULE_TAG=PASS_DISABILI) | 2026-10-03 |
| [faq-prima-richiesta.md](faq-prima-richiesta.md) | [FAQ KA-01318: prima richiesta](https://servizicrm.comune.milano.it/centro-supporto/KA-01318/Domanda-pass-disabili-prima-richiesta) (agg. 01/12/2025) | 2026-10-03 |
| [modulo-delega.md](modulo-delega.md) | [MOD. DELEGA (mod-delega-3)](https://www.comune.milano.it/documents/d/guest/mod-delega-3?download=true), PDF in `allegati/` | 2026-10-03 |
| [sedi.json](sedi.json) | Open data del Comune ([dati.comune.milano.it](https://dati.comune.milano.it)): anagrafe (ds549), Servizio Sociale Territoriale (ds1303), patronati (ds550, **elenco del 2018**), Municipi (ds1299), fermate metro (ds535, **senza dati di accessibilità**). Via Sile 8 aggiunta a mano dalla pagina del servizio. Generato da [`fetch_sedi.py`](../fetch_sedi.py): rilanciarlo solo per aggiornare. | 2026-10-03 |

## Da aggiungere (FAQ collegate del Centro supporto)

- [KA-01514 Rinnovo](https://servizicrm.comune.milano.it/centro-supporto/KA-01514/Rinnovo-pass-disabili)
- [KA-01189 Chi può chiederlo e cosa consente](https://servizicrm.comune.milano.it/centro-supporto/KA-01189/Pass-disabili-chi-puo-chiederlo-e-funzioni)
- [KA-01188 Documenti necessari](https://servizicrm.comune.milano.it/centro-supporto/KA-01188/Documenti-per-richiesta-pass-disabili)
- [KA-01314 Duplicato](https://servizicrm.comune.milano.it/centro-supporto/KA-01314/Richiesta-duplicato-pass-disabili)
- [KA-01187 Proroga](https://servizicrm.comune.milano.it/centro-supporto/KA-01187/Richiesta-proroga-pass-disabili)
- [KA-01147 Registrazione targa](https://servizicrm.comune.milano.it/centro-supporto/KA-01147/Registrazione-targa-per-pass-disabili)
- [KA-00985 Cambio temporaneo targa master](https://servizicrm.comune.milano.it/centro-supporto/KA-00985/Modulo-richiesta-pass-disabili)
- [KA-01684 Tempi](https://servizicrm.comune.milano.it/centro-supporto/KA-01684/Tempi-di-ottenimento-pass-disabili)
- [KA-01149 Serve una richiesta?](https://servizicrm.comune.milano.it/centro-supporto/KA-01149/Richiesta-pass-disabili-procedura)
- [KA-01203 Transito occasionale ZTL/Area B/C](https://servizicrm.comune.milano.it/centro-supporto/KA-01203/Richiesta-transito-veicolo-disabili)

Già nel repo: [`docs/procedura-pass-disabili.md`](../docs/procedura-pass-disabili.md) (procedura completa, rielaborata).
