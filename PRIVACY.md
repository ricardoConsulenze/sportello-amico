# Privacy by design

> The service sees the bare minimum, stores nothing and decides nothing: it checks, explains, and leaves
> the choice to the person and to the office.

## What stays in the browser and what goes to Claude
| Data | Where it is processed | Sent to Claude? |
|---|---|---|
| ID card (front/back), applicant's ID | Browser: HEIC→JPG conversion and compression | **Only if the person agrees** (asked once; "🔒 No, restano qui" keeps them local). Claude answers yes/no checks only: right side, legible |
| Passport photo | Browser: crop to 35×45 and colour check | **Only if the person agrees**. Checks: one face visible, colour, not a photo of a screen. Claude never describes the person |
| Delegation form (names, document numbers) | Browser: printable form | **Only if the person agrees**, the signed copy. Checks: right form, filled in, signed. Names and numbers are never transcribed |
| Atto di nomina | Browser | **Only if the person agrees**. Checks: right kind of document, legible |
| Plate number | Browser, used only by the guide | **No** |
| Medical document (verbale / certificate) | Server → Claude, in memory | **Yes**, only to check the rules |
| Summary screenshot | Server → Claude, in memory | **Yes**, and the user is invited to cover name and tax code |
| Free questions to the chatbot (when enabled) | LangGraph server, thread deleted on "Cancella tutto" | **Yes**, the text the user types; the box warns not to write names or tax codes. Only non-personal counter state (stage, role, request type) goes with it |

## Rules (P1–P7)
- **P1. Minimise.** Claude receives only the documents that need reading: always the medical document and the summary, the other attachments only with the person's consent (`/api/check-document`), which returns pass/fail per check and never the data it read. Prompts forbid transcribing names, tax codes, dates of birth or plates, and forbid commenting on diagnoses.
- **P2. No storage.** No database; uploads live in memory for the duration of the request. The browser keeps files only for the session, and "Cancella tutto" empties everything.
- **P3. No content logs.** The server logs method, path and status only.
- **P4. No submission.** The assistant never sends anything to the Comune and has no SPID integration; the person submits on the official site.
- **P5. No decisions.** Completeness checks only, with "not sure" when in doubt. The office decides. This keeps us out of automated decisions on eligibility.
- **P6. Data, not instructions.** Text inside documents is never treated as instructions (prompt injection).
- **P7. Demo data only.** The Comune's two public sample verbali plus clearly marked fictitious documents (FAC-SIMILE). No real personal data in the repository.

## Next steps with the Comune (not done in the prototype)
- The Comune as **data controller**, the tool provider as processor; a data processing agreement, including with Anthropic (check retention, zero data retention, processing location).
- A **DPIA** (data protection impact assessment): health data, vulnerable people, new technology.
- **Legal basis:** public interest task and art. 9(2)(g) GDPR for the Comune; explicit consent for a standalone tool.
- **EU AI Act:** tell users they are talking to an AI (done in the welcome message). Human decision on eligibility (done by design).
- The "renewal reminder" and "hand-off to a family member" ideas would require storage: opt-in only, and handled by the Comune.
