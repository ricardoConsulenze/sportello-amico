"""Rules the assistant applies, taken from the Comune di Milano online form (CUDE) and service pages.

Each rule has an id, the text Claude checks against, and the official source shown to the user
and to the office. Keep this file as the single source of truth: the server prompt and the
office summary sheet are both built from it.

Source of truth: the public page of the online form (FORM, saved in knowledge/modulo-cude-presentazione.md).
Other sources only add detail and never override it. ORIGIN records where each rule comes from.
"""

FORM = "https://formshd2.comune.milano.it/rwe2/module_preview.jsp?MODULE_TAG=PASS_DISABILI"
PAGE = "https://www.comune.milano.it/servizi/mobilita/pass-per-la-sosta-e-la-circolazione-di-persone-con-disabilita"
FAQ_FIRST = "https://servizicrm.comune.milano.it/centro-supporto/KA-01318/Domanda-pass-disabili-prima-richiesta"

RULES = {
    "R1": ("Possono fare domanda: la persona con disabilità, il genitore di un figlio minorenne, un delegato, "
           "il legale rappresentante (tutore, protutore, procuratore, amministratore di sostegno) con i poteri necessari.", FORM),
    "R2": ("Allegati sempre richiesti: documento d'identità fronte/retro del titolare, fototessera recente a colori "
           "(35x45 mm), documentazione sanitaria.", FORM),
    "R3": ("Se si fa domanda per un'altra persona: documento fronte/retro del richiedente e delega firmata dal "
           "delegante. Il legale rappresentante deve essere munito dei necessari poteri (la FAQ del Comune "
           "consiglia di allegare l'atto di nomina).", FORM),
    "R4": ("Primo rilascio: certificato di deambulazione sensibilmente ridotta in corso di validità rilasciato "
           "dall'ufficio medico legale dell'azienda sanitaria, oppure verbale d'invalidità o handicap con "
           "riconoscimento dello status di non vedente (L. 382/70) o con l'indicazione di capacità di deambulazione "
           "sensibilmente ridotta (art. 381 DPR 495/1992). Sono valutate anche le sentenze omologate.", FORM),
    "R5": ("Il verbale va allegato come un unico PDF con tutte le pagine della versione OMISSIS, conforme "
           "all'originale, in corso di validità, senza revoche, modifiche, alterazioni o sostituzioni.", FORM),
    "R6": ("Rinnovo di un pass ottenuto per invalidità permanente: certificato del medico curante che attesti "
           "\"alla data odierna persistono le condizioni sanitarie che hanno portato al rilascio del pass disabili\", "
           "oppure verbale con art. 381 DPR 495/92 o L. 382/70 con attestazione di non revisione o esonero da "
           "future revisioni (DM 02/08/2007).", FORM),
    "R7": ("Il pass dura quanto il diritto su cui si basa e comunque non oltre 5 anni, anche per invalidità "
           "permanenti.", FORM),
    "R8": ("La modalità di consegna (raccomandata a domicilio o ritiro su appuntamento) non si può modificare "
           "dopo la scelta.", FORM),
    "R9": ("Allegati in PDF, JPG o PNG, massimo 5 MB ciascuno. Fototessera solo JPG o PNG.", FORM),
    "R10": ("Il modulo online gestisce solo rilascio e rinnovo. Proroga (attesa visita INPS) e duplicato "
            "si chiedono prenotando una chiamata.", PAGE),
    "R11": ("Le comunicazioni sulla domanda arrivano al telefono e all'email indicati per il titolare.", FORM),
    "R12": ("La targa si può associare subito o in un secondo momento. Se si associa, va scelto se aderire o no "
            "alla Piattaforma nazionale CUDE (MIT).", FORM),
}

# Where each rule comes from:
# - "pagina_pubblica": the public form page, the source of truth
# - "schermate_interne": the form screens behind SPID/CIE login (same form, no saved copy yet)
# - "pagina_servizio": the Comune service page
# The 35x45 mm photo size in R2 and the atto di nomina advice in R3 are details from FAQ_FIRST.
ORIGIN = {
    "R1": "pagina_pubblica", "R2": "pagina_pubblica", "R3": "pagina_pubblica", "R4": "pagina_pubblica",
    "R5": "pagina_pubblica", "R6": "pagina_pubblica", "R7": "pagina_pubblica", "R8": "pagina_pubblica",
    "R9": "schermate_interne", "R10": "pagina_servizio", "R11": "schermate_interne", "R12": "schermate_interne",
}

PHRASE_R6 = "alla data odierna persistono le condizioni sanitarie che hanno portato al rilascio del pass disabili"


def rules_for(request_type: str, permanent: bool | None) -> list[str]:
    """Which medical-document rules apply to this case."""
    if request_type == "rinnovo" and permanent:
        return ["R6", "R5"]
    return ["R4", "R5"]


def rules_text(ids: list[str]) -> str:
    return "\n".join(f"{i}: {RULES[i][0]}" for i in ids)


# Checks on the other attachments (identity document, photo, delega, atto di nomina), made by Claude only
# when the person agrees. Each check comes from R2 or R3: only what the form asks, nothing more (the form
# does not say the identity document must be in date, so we do not check it).
# kind -> [(check id, what Claude verifies, rule)]
DOC_CHECKS = {
    "id_front": [
        ("tipo", "È un documento d'identità (carta d'identità, passaporto o patente).", "R2"),
        ("lato", "Si vede il fronte, cioè il lato con la foto della persona.", "R2"),
        ("leggibile", "Il documento è intero e leggibile: si vedono i bordi, senza riflessi o parti sfocate.", "R2"),
    ],
    "id_back": [
        ("tipo", "È un documento d'identità (carta d'identità, passaporto o patente).", "R2"),
        ("lato", "Si vede il retro, cioè il lato opposto a quello con la foto principale.", "R2"),
        ("leggibile", "Il documento è intero e leggibile: si vedono i bordi, senza riflessi o parti sfocate.", "R2"),
    ],
    "photo": [
        ("persona", "È la foto di una sola persona, con il viso intero, visibile e di fronte.", "R2"),
        ("colori", "La foto è a colori.", "R2"),
        ("originale", "È una fotografia della persona, non la foto di un documento, di una stampa o di uno schermo.", "R2"),
    ],
    "delega": [
        ("modulo", "È una delega per la domanda del pass disabili (per esempio il MOD. DELEGA del Comune).", "R3"),
        ("compilata", "Le parti su chi delega e su chi è delegato sono compilate.", "R3"),
        ("firma", "C'è la firma di chi delega.", "R3"),
    ],
    "nomina": [
        ("tipo", "È un atto di nomina di tutore, protutore, procuratore o amministratore di sostegno.", "R3"),
        ("leggibile", "Il documento è intero e leggibile.", "R3"),
    ],
}


def doc_checks_text(kind: str) -> str:
    return "\n".join(f"- {cid}: {text} (regola {rule})" for cid, text, rule in DOC_CHECKS[kind])
