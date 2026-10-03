/* Sportello Amico: a friendly counter clerk (chat, left) and a table with an envelope (right).
 * Documents land on the table as paper cards; Claude reads the medical one and a rubber stamp
 * comes down. Then the clerk walks the person through a replica of the real Comune form.
 *
 * Privacy: ID cards, photo, delegation and plate never leave this browser. Only the medical
 * document and the summary screenshot go to our server, which forwards them to Claude and keeps nothing.
 */
"use strict";

const MAX_BYTES = 5 * 1024 * 1024; // R9
const SRC = {
  form: "https://formshd2.comune.milano.it/rwe2/module_preview.jsp?MODULE_TAG=PASS_DISABILI",
  extension: "https://servizicrm.comune.milano.it/callasap/richiestaappuntamento/passprovvisorioinattesadivisitaINPS",
  duplicate: "https://servizicrm.comune.milano.it/callasap/serviziperladisabilita/richiestaappuntamento",
  delega: "https://www.comune.milano.it/documents/d/guest/mod-delega-3?download=true",
};
const PHRASE_R6 = "alla data odierna persistono le condizioni sanitarie che hanno portato al rilascio del pass disabili";
const ROLES = {
  self: { label: "Per me", official: "persona con disabilità", other: false, kw: ["me", "io", "stesso", "stessa", "mio pass"] },
  parent: { label: "Per mio figlio o mia figlia", sub: "minorenne", official: "genitore di persona minorenne", other: true, kw: ["figlio", "figlia", "bambino", "bambina", "minorenne"] },
  delegate: { label: "Per un familiare o un amico", sub: "con la sua delega", official: "delegato", other: true, kw: ["mamma", "madre", "papà", "padre", "nonna", "nonno", "marito", "moglie", "zia", "amico", "delega", "familiare"] },
  legal: { label: "Sono tutore o amministratore di sostegno", official: "legale rappresentante della persona con disabilità", other: true, kw: ["tutore", "amministratore", "sostegno", "procuratore", "giudice"] },
};
// demo identities for the simulated login: invented people, no real data
const USERS = {
  lucia: { name: "Lucia Verdi", first: "Lucia", face: "👩‍🦱" },
  giorgio: { name: "Giorgio Bianchi", first: "Giorgio", face: "👴" },
  samira: { name: "Samira El Amrani", first: "Samira", face: "👩" },
};
const TABS = ["Informativa Privacy", "Dati richiedente", "Dati intestatario del pass disabili", "Richiesta Pass",
  "Dichiarazioni integrative", "Modalità di ritiro del pass", "Targa", "Riepilogo", "Convalida", "Inoltra"];

let S;
const fresh = () => ({
  user: null, role: null, request: null, permanent: null, canGoOut: null, car: null, plate: "",
  files: {}, // slot -> {blob, name, url, note, status: scanning|ok|bad|warn, stamp, demo}
  medical: null, rehearsal: null, stage: "welcome", tab: 1, chips: [], mock: false,
  consent: null, // may Claude check the identity document, photo and delega? null (not asked yet) | "check" | "local"
});
S = fresh();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = () => S.role && ROLES[S.role].other;
const holder = () => (S.role === "self" ? "te" : S.role === "parent" ? "tuo figlio o tua figlia" : "la persona con disabilità");

// ===================================================================================== chat

let voiceOn = false;
// emoji are decoration: screen readers and the voice would read "cestino", "busta"...
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic})*/gu;
const HAS_EMOJI = new RegExp(EMOJI.source, "u"); // no /g: test() must not keep lastIndex
function hideEmoji(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) if (HAS_EMOJI.test(walk.currentNode.data) && !walk.currentNode.parentElement.closest(".emoji")) nodes.push(walk.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    let last = 0;
    n.data.replace(EMOJI, (m, i) => {
      frag.append(n.data.slice(last, i));
      const sp = document.createElement("span"); sp.className = "emoji"; sp.setAttribute("aria-hidden", "true"); sp.textContent = m;
      frag.append(sp); last = i + m.length;
    });
    frag.append(n.data.slice(last));
    n.replaceWith(frag);
  });
  return root;
}

function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text.replace(EMOJI, " "));
  u.lang = "it-IT"; u.rate = 0.92;
  // only on-device voices: network voices (e.g. "Google italiano") send the text to the vendor's servers
  const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith("it") && x.localService);
  if (!v) return;
  u.voice = v;
  speechSynthesis.speak(u);
}

function addMsg(who, html) {
  const el = document.createElement("div");
  el.className = `msg ${who === "me" ? "me" : ""}`;
  el.innerHTML = who === "me" ? `<div class="bubble">${html}</div>`
    : `<div class="face" aria-hidden="true">🧑‍💼</div><div class="bubble">${html}</div>`;
  $("chat").appendChild(hideEmoji(el));
  $("chat").scrollTop = $("chat").scrollHeight;
  if (who !== "me") speak(el.querySelector(".bubble").innerText);
  return el;
}

async function bot(...parts) { // several short bubbles read better than one long one
  for (const p of parts) { addMsg("bot", p); await sleep(350); }
}

function chips(list) {
  S.chips = list;
  const box = $("chips");
  box.innerHTML = "";
  list.forEach((c) => {
    const b = document.createElement("button");
    b.className = `chip ${c.soft ? "soft" : ""}`;
    b.innerHTML = `${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}`;
    hideEmoji(b);
    b.addEventListener("click", () => choose(c));
    box.appendChild(b);
  });
  box.querySelector("button")?.focus({ preventScroll: true });
}

function choose(c) {
  if (!c.keep) chips([]);
  if (c.echo !== false) addMsg("me", esc(c.label));
  c.do();
}

// ===================================================================================== voice input

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("mic");
  if (!SR) { mic.hidden = true; $("mic-hint").textContent = "Tocca un pulsante per rispondere."; return; }
  mic.addEventListener("click", () => {
    const rec = new SR();
    rec.lang = "it-IT"; rec.interimResults = false; rec.maxAlternatives = 3;
    mic.classList.add("listening"); $("mic-hint").textContent = "Ti ascolto…";
    rec.onresult = (e) => {
      const said = [...e.results[0]].map((a) => a.transcript.toLowerCase());
      const hit = matchChip(said);
      if (hit) choose(hit);
      else if (Connectors.chat.enabled) askChat(said[0]);
      else bot(`Ho capito "${esc(said[0])}", ma non sono sicuro. Puoi toccare uno dei pulsanti?`);
    };
    rec.onend = () => { mic.classList.remove("listening"); $("mic-hint").textContent = "Puoi toccare un pulsante oppure rispondere a voce."; };
    rec.start();
  });
}

function matchChip(alternatives) {
  let best = null, score = 0;
  for (const c of S.chips) {
    const words = (c.kw || []).concat(c.label.toLowerCase().split(/[^a-zàèéìòù]+/).filter((w) => w.length > 3));
    for (const said of alternatives) {
      const s = words.filter((w) => said.includes(w)).length + (/\b(sì|si|certo|esatto)\b/.test(said) && c.yes ? 2 : 0) + (/\bno\b/.test(said) && c.no ? 2 : 0);
      if (s > score) { score = s; best = c; }
    }
  }
  return best;
}

// ===================================================================================== free questions (/api/ask or LangGraph)

function setupAsk() {
  if (!Connectors.chat.enabled) return;
  $("ask").hidden = false;
  $("mic-hint").textContent = "Puoi toccare un pulsante, scrivere una domanda o rispondere a voce.";
  $("ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("ask-input").value.trim();
    if (!text) return;
    $("ask-input").value = "";
    askChat(text);
  });
}

// only the counter's state goes with the question: no names, documents or plate
const chatContext = () => ({ stage: S.stage, tab: S.tab, role: S.role, request: S.request, permanent: S.permanent,
  medical_outcome: S.medical?.esito_generale || null });

// the chat answer: escaped first, then only **bold** and [text](https://…) links are turned into HTML
const safeHttp = (u) => /^https?:\/\//i.test(u);
function chatHtml(text) {
  return text.split(/\n{2,}/).map((p) => `<p>${esc(p)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = url.replace(/&amp;/g, "&");
      return safeHttp(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : label;
    })
    .replace(/\n/g, "<br>")}</p>`).join("");
}

// offices found by the assistant (open data of the Comune), each with its source and any warning
function sediHtml(sedi) {
  if (!sedi.length) return "";
  const row = (s) => `<li><strong>${esc(s.nome)}</strong><br>${esc(s.indirizzo || "")}${
    s.orari ? `<br>🕘 ${esc(s.orari)}` : ""}${s.telefono ? `<br>📞 ${esc(s.telefono)}` : ""}${
    s.metro_vicina ? `<br>🚇 ${esc(s.metro_vicina)}` : ""}${s.note ? `<br><span class="small">${esc(s.note)}</span>` : ""}${
    s.avviso ? `<br><span class="small">⚠️ ${esc(s.avviso)}</span>` : ""}${
    s.fonte?.url && safeHttp(s.fonte.url) ? `<br><a class="small" href="${esc(s.fonte.url)}" target="_blank" rel="noopener">Fonte: ${esc(s.fonte.titolo)}</a>` : ""}</li>`;
  return `<p><strong>📍 Dove andare</strong></p><ul>${sedi.map(row).join("")}</ul>`;
}

// the official texts the answer comes from: one line per document, linked to the Comune page
function fontiHtml(fonti) {
  const docs = [...new Map(fonti.map((f) => [f.titolo, f])).values()];
  if (!docs.length) return "";
  const item = (f) => (f.fonte && safeHttp(f.fonte)
    ? `<a href="${esc(f.fonte)}" target="_blank" rel="noopener">${esc(f.titolo)}</a>` : esc(f.titolo));
  return `<p class="small">📄 Da dove viene la risposta: ${docs.map(item).join(" · ")}</p>`;
}

async function askChat(text) {
  addMsg("me", esc(text));
  const el = document.createElement("div");
  el.className = "msg";
  el.innerHTML = `<div class="face" aria-hidden="true">🧑‍💼</div><div class="bubble"><p class="typing">Sto pensando…</p></div>`;
  $("chat").appendChild(el);
  const bubble = el.querySelector(".bubble");
  let answer = "", extra = "";
  try {
    for await (const piece of Connectors.chat.ask(text, chatContext())) {
      if (typeof piece === "string") answer += piece;
      else extra = sediHtml(piece.sedi || []) + fontiHtml(piece.fonti || []);
      bubble.innerHTML = chatHtml(answer) + extra;
      $("chat").scrollTop = $("chat").scrollHeight;
    }
    if (!answer) bubble.innerHTML = "<p>Non ho una risposta. Puoi chiedere all'ufficio: 📞 02 884 52909.</p>";
  } catch (e) {
    if (e.name === "AbortError") return el.remove();
    bubble.innerHTML = `<p>${esc(e.message)}</p>`;
  }
  speak(bubble.innerText);
}

// ===================================================================================== the conversation

async function welcome() {
  S.stage = "welcome"; renderTable();
  await bot(
    `<p><strong>Buongiorno${S.user ? ` ${esc(USERS[S.user].first)}` : ""}!</strong> Sono lo Sportello Amico.</p><p>Prepariamo insieme la <strong>busta per il pass disabili</strong>: ti dico cosa serve, guardo i documenti e poi ti accompagno nel modulo del Comune.</p>`,
    `<p>🔒 <strong>Tre promesse</strong></p><ul><li>Guardo i documenti <strong>solo per controllarli</strong>.</li><li><strong>Non invio niente al Comune</strong>: la domanda la invii tu.</li><li><strong>Non conservo niente</strong>. Alla fine premi "Cancella tutto".</li></ul><p class="small">Non decido se hai diritto al pass: decide l'ufficio. Io controllo che la domanda sia completa.</p>`);
  chips([
    { label: "Iniziamo", kw: ["inizia", "iniziamo", "va bene", "ok", "pronto"], yes: true, do: askRole },
    { label: "🔊 Leggimi i messaggi ad alta voce", soft: true, keep: true, echo: false, do: () => { toggleVoice(true); bot("Va bene, da ora ti leggo tutto ad alta voce."); } },
    { label: "Chi legge i miei documenti?", soft: true, do: explainPrivacy },
  ]);
}

async function explainPrivacy() {
  await bot(`<p>Il documento d'identità, la foto e la delega <strong>restano sul tuo telefono o computer</strong>: li sistemo io qui. Te lo chiedo prima: li faccio controllare a Claude <strong>solo se mi dici di sì</strong>.</p>
    <p>Solo il <strong>documento sanitario</strong> lo faccio leggere a Claude, un'intelligenza artificiale, e guarda <strong>solo i riferimenti che chiede il Comune</strong>, non la diagnosi. Non viene salvato.</p>`);
  chips([{ label: "Ho capito, iniziamo", yes: true, do: askRole }]);
}

async function askRole() {
  await bot("<p>Per chi fai la domanda?</p>");
  chips([...Object.entries(ROLES).map(([k, r]) => ({ label: r.label, sub: r.sub, kw: r.kw, do: () => { S.role = k; askRequest(); } })),
    { label: "Non lo so", soft: true, do: helpRole }]);
}

async function helpRole() {
  await bot(`<p><strong>Tutore o amministratore di sostegno</strong>: se un giudice ti ha nominato con un decreto.</p>
    <p><strong>Familiare o amico</strong>: se la persona può firmare una delega. Te la preparo io.</p>
    <p><strong>Figlio o figlia</strong>: se ha meno di 18 anni.</p>`);
  askRole();
}

async function askRequest() {
  await bot(S.role === "self" ? "<p>Cosa ti serve?</p>" : "<p>Cosa serve alla persona?</p>");
  chips([
    { label: "È il primo pass", kw: ["primo", "nuovo", "mai"], do: () => { S.request = "nuovo"; openDesk(); } },
    { label: "Rinnovare il pass", sub: "sta per scadere", kw: ["rinnov", "scade", "scadenza"], do: () => { S.request = "rinnovo"; askPermanent(); } },
    { label: "Aspetto la visita INPS", sub: "e il pass sta scadendo", kw: ["inps", "visita", "revisione", "proroga"], do: () => routeOut("proroga") },
    { label: "L'ho perso o me l'hanno rubato", kw: ["perso", "rubato", "rotto", "rovinato", "duplicato"], do: () => routeOut("duplicato") },
    { label: "🏢 Preferisco andare di persona", soft: true, keep: true, echo: false, do: openOffice },
  ]);
}

async function routeOut(kind) {
  const ext = kind === "proroga";
  await bot(`<p>${ext ? "Per questo c'è una strada più semplice: il Comune ti dà un pass valido <strong>6 mesi</strong> mentre aspetti l'INPS." : "Per il duplicato c'è una strada diversa."}</p>
    <p>Non si usa il modulo online: <strong>prenoti una telefonata</strong> e ti richiamano loro.</p>
    <p class="small">Tieni pronti: ${ext ? "verbale con revisione o lettera di convocazione INPS, fototessera, documento d'identità, pass in scadenza, libretto dell'auto" : "documento d'identità, fototessera, eventuale denuncia, libretto dell'auto"}.</p>`);
  chips([
    { label: "📞 Prenota la telefonata", keep: true, echo: false, do: () => window.open(ext ? SRC.extension : SRC.duplicate, "_blank", "noopener") },
    { label: "🏢 Preferisco andare di persona", soft: true, keep: true, echo: false, do: openOffice },
    { label: "Ho sbagliato, torna indietro", soft: true, do: askRequest },
  ]);
}

async function askPermanent() {
  await bot(`<p>Il pass di adesso era stato dato per un'invalidità <strong>permanente</strong>?</p><p class="small">Sul verbale c'è scritto "esonero da future visite di revisione: SI".</p>`);
  chips([
    { label: "Sì, permanente", yes: true, kw: ["permanente", "sempre"], do: () => { S.permanent = true; openDesk(); } },
    { label: "No, ha una revisione", no: true, kw: ["revisione", "scadenza"], do: () => { S.permanent = false; openDesk(); } },
    { label: "Non lo so", kw: ["so"], do: () => { S.permanent = null; openDesk(); } },
  ]);
}

// ===================================================================================== the envelope

function slots() {
  const list = [{ id: "medical", icon: "🩺", name: S.request === "rinnovo" && S.permanent ? "Certificato del medico o verbale" : "Verbale INPS", hint: "tutte le pagine" },
    { id: "idFront", icon: "🪪", name: `Documento di ${S.role === "self" ? "identità" : "chi ha il pass"}`, hint: "fronte" },
    { id: "idBack", icon: "🪪", name: `Documento di ${S.role === "self" ? "identità" : "chi ha il pass"}`, hint: "retro" },
    { id: "photo", icon: "🙂", name: "Fototessera", hint: "a colori, 35×45" }];
  if (other()) list.push({ id: "reqFront", icon: "🪪", name: "Il tuo documento", hint: "fronte" }, { id: "reqBack", icon: "🪪", name: "Il tuo documento", hint: "retro" });
  if (S.role === "delegate") list.push({ id: "delega", icon: "✍️", name: "Delega firmata", hint: "te la preparo io" });
  if (S.role === "legal") list.push({ id: "nomina", icon: "⚖️", name: "Decreto di nomina", hint: "del giudice" });
  return list;
}
const FILE_NAMES = { medical: "documento_sanitario", idFront: "documento_titolare_fronte", idBack: "documento_titolare_retro", photo: "fototessera_35x45",
  reqFront: "documento_richiedente_fronte", reqBack: "documento_richiedente_retro", delega: "delega_firmata", nomina: "atto_di_nomina", summary: "riepilogo" };

// ===================================================================================== examples and transparency

const renewalCert = () => S.request === "rinnovo" && S.permanent;
// PRIVACY.md: the medical document and the summary always go to the check; the other attachments only if the person agrees
const KIND = { idFront: "id_front", reqFront: "id_front", idBack: "id_back", reqBack: "id_back", photo: "photo", delega: "delega", nomina: "nomina" };
const goesToCheck = (id) => id === "medical" || id === "summary" || (KIND[id] && (S.consent === "check" || !!S.files[id]?.check));
const where = (id) => goesToCheck(id) ? "🔎 Lo legge il controllo automatico, poi viene cancellato"
  : KIND[id] && S.consent === null ? "🔒 Resta sul tuo telefono o computer, se non mi chiedi di controllarlo" : "🔒 Resta sul tuo telefono o computer";
const HEIC = "📱 Le foto dell'iPhone le converto io: puoi usarle così come sono.";

function why(id) {
  const t = {
    medical: renewalCert()
      ? "Per rinnovare un pass permanente il Comune chiede al medico di confermare, con una frase precisa, che le condizioni non sono cambiate."
      : "Il Comune deve leggere nel verbale che camminare è molto difficile (art. 381) o lo status di non vedente, e lo vuole completo, in un unico PDF.",
    idFront: "Serve all'ufficio per sapere con certezza chi riceverà il pass.",
    photo: "La foto va sul pass, per riconoscere chi lo usa: per questo deve essere recente e a colori.",
    reqFront: "Chi fa la domanda per un'altra persona deve mostrare anche il proprio documento, fronte e retro.",
    delega: "La delega dimostra che la persona con disabilità ti ha chiesto di fare la domanda per lei.",
    nomina: "Il decreto dimostra che il giudice ti ha nominato e che puoi fare la domanda per la persona.",
    summary: "Alcune scelte, come la consegna, dopo l'invio non si cambiano: meglio ricontrollare prima.",
  };
  return t[id] || t[{ idBack: "idFront", reqBack: "reqFront" }[id]];
}

// "where it goes" + "why" (on request), shown when asking for a document and in the card detail
const transparency = (id) => `<p class="small where">${where(id)}</p>
  <details class="why"><summary>Perché serve?</summary><p>${esc(why(id))} <a href="${SRC.form}" target="_blank" rel="noopener">Fonte: modulo del Comune</a></p></details>`;

const ex = (img, alt, title, fix, demo) => ({ img, alt, title, fix, demo });
function examples(id) {
  const front = { ok: [ex("documento-fronte-ok", "Fac-simile del davanti di una carta d'identità: si vedono tutti e quattro gli angoli, le scritte sono nitide. Segno verde.", "Intero, dritto e leggibile, con tutti e 4 gli angoli.")],
    no: [ex("documento-no-tagliato", "Fac-simile di carta d'identità con un angolo tagliato fuori dalla foto, cerchiato in rosso.", "Un angolo è tagliato fuori.", "Allontana un po' il telefono: devono vedersi tutti i bordi."),
      ex("documento-no-riflesso", "Fac-simile di carta d'identità con una macchia bianca di riflesso sopra le scritte, cerchiata in rosso.", "Il riflesso copre le scritte.", "Spegni il flash e mettiti vicino a una finestra.")], note: HEIC };
  const back = { ok: [ex("documento-retro-ok", "Fac-simile del retro di una carta d'identità, intero e leggibile. Segno verde.", "Il retro, intero e leggibile.")],
    no: [ex("documento-no-solo-fronte", "Due foto dello stesso lato della carta d'identità: manca il retro, cerchiato in rosso.", "C'è solo il davanti, due volte.", "Gira il documento e fotografa anche il retro.")], note: HEIC };
  const E = {
    medical: renewalCert()
      ? { ok: [ex("certificato-ok", "Fac-simile di certificato del medico con la frase richiesta dal Comune evidenziata in verde.", `Contiene la frase esatta: "${PHRASE_R6}".`, "", { file: "B2_giorgio_certificato_corretto.png", label: "Prova con questo esempio" })],
        no: [ex("certificato-no-frase", "Fac-simile di certificato del medico generico: lo spazio dove dovrebbe esserci la frase è cerchiato in rosso.", "Certificato generico: manca la frase. Anche parole simili non bastano.", "Chiedi al medico la frase esatta: ti preparo la lettera da portargli.", { file: "B_giorgio_certificato_generico.png", label: "Prova con questo esempio" })],
        note: "In alternativa va bene il verbale con \"esonero da future revisioni\"." }
      : { ok: [ex("verbale-ok", "Fac-simile di verbale INPS: tre pagine numerate da 1 di 3 a 3 di 3, versione OMISSIS, unite in un solo file. Segno verde.", "Tutte le pagine (Pagina 1 di 3, 2 di 3, 3 di 3), versione OMISSIS, in un unico PDF.", "", { file: "C_verbale_completo_fittizio.pdf", label: "Prova con questo esempio" })],
        no: [ex("verbale-no-pagine", "Fac-simile di verbale INPS con una sola pagina: in fondo c'è scritto Pagina 5 di 7, cerchiato in rosso.", "Solo una pagina: in fondo c'è scritto \"Pagina 5 di 7\".", "Scarica dal sito INPS il verbale completo, versione OMISSIS (quella senza diagnosi). Se lo fotografi, fai tutte le pagine: le unisco io.", { file: "A_lucia_verbale_solo_pagina5.pdf", label: "Prova con questo esempio" })],
        note: "In alternativa al verbale va bene il certificato dell'ASL di deambulazione sensibilmente ridotta. " + HEIC },
    idFront: front, reqFront: front, idBack: back, reqBack: back,
    photo: { ok: [ex("foto-ok", "Fac-simile di fototessera a colori: viso di fronte, sfondo chiaro e uniforme, senza cappello. Segno verde.", "A colori, viso di fronte, sfondo chiaro, senza cappello né occhiali scuri.")],
      no: [ex("foto-no-bianconero", "Fac-simile di fototessera in bianco e nero, cerchiata in rosso.", "In bianco e nero.", "Il Comune la vuole a colori: rifai la foto col telefono."),
        ex("foto-no-selfie", "Fac-simile di selfie con il braccio in vista, sfondo pieno di oggetti e cappello, cerchiati in rosso.", "Selfie con cappello e sfondo pieno di cose.", "Fatti fotografare da qualcuno davanti a un muro chiaro, senza cappello.")],
      note: "La taglio io nella misura giusta (35×45 mm). " + HEIC },
    delega: { ok: [ex("delega-ok", "Fac-simile di modulo di delega compilato, con la firma della persona con disabilità in fondo. Segno verde.", "Compilata e firmata dalla persona con disabilità.")],
      no: [ex("delega-no-firma", "Fac-simile di modulo di delega con lo spazio della firma vuoto, cerchiato in rosso.", "Manca la firma.", "Falla firmare alla persona con disabilità, poi fotografala.")],
      note: "Nella busta deve esserci anche il documento della persona che firma: è il foglio \"Documento di chi ha il pass\"." },
    nomina: { ok: [ex("nomina-ok", "Fac-simile di decreto di nomina del giudice, tutte le pagine leggibili. Segno verde.", "Tutte le pagine del decreto, leggibili.")],
      no: [ex("nomina-no-pagine", "Fac-simile di decreto con una sola pagina: mancano le altre, cerchiato in rosso.", "Si vede solo la prima pagina.", "Fotografa tutte le pagine (puoi sceglierne più di una): le unisco io in un PDF.")] },
  };
  return E[id];
}

function showExample(id) {
  const s = slots().find((x) => x.id === id) || { icon: "📄", name: "Documento", hint: "" };
  const e = examples(id);
  if (!e) return;
  const fig = (x, ok) => `<figure class="ex ${ok ? "ok" : "no"}"><figcaption><strong>${ok ? "✅ Così va bene" : "❌ Così no"}</strong></figcaption>
    <img src="examples/${x.img}.svg" alt="${esc(x.alt)}" width="300" height="400">
    <p>${esc(x.title)}</p>${x.fix ? `<p><strong>Cosa fare:</strong> ${esc(x.fix)}</p>` : ""}
    ${x.demo ? `<button class="chip soft" data-demo="${esc(x.demo.file)}">▶ ${esc(x.demo.label)}</button>` : ""}</figure>`;
  sheet(`👀 Esempio: ${s.name}${s.hint ? ` (${s.hint})` : ""}`, `<p>Sono esempi finti (FAC-SIMILE), senza dati veri.</p>
    <div class="ex-grid">${e.ok.map((x) => fig(x, true)).join("")}${e.no.map((x) => fig(x, false)).join("")}</div>
    ${e.note ? `<p>${esc(e.note)}</p>` : ""}${transparency(id)}`);
  $("sheet-body").querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => {
    $("sheet").close(); chips([]); loadDemo(id, b.dataset.demo);
  }));
}

const RULE_PLAIN = { R4: "il riferimento che chiede il Comune (art. 381 o L. 382/70)", R5: "tutte le pagine, versione OMISSIS, in un unico PDF",
  R6: "la frase esatta del medico per il rinnovo" };
const ESITO = { trovato: "✅ c'è", manca: "❌ manca", non_sicuro: "❓ non sono sicuro" };
const ESITO_DOC = { trovato: "✅ sì", manca: "❌ no", non_sicuro: "❓ non sono sicuro" }; // the document checks are yes/no questions

function howChecked(m, id = "medical") {
  const notLooked = id === "medical"
    ? ["Non ho letto la diagnosi e non la giudico.", "Non ho copiato nomi, codici fiscali o date di nascita."]
    : ["Non ho copiato nomi, numeri del documento o date.", ...(id === "photo" ? ["Non ho descritto la persona nella foto."] : [])];
  sheet("🔎 Come ho controllato?", `<p>Il controllo automatico lo fa <strong>Claude, un'intelligenza artificiale</strong>.${m.mock ? " In questa dimostrazione le risposte sono preimpostate." : ""}</p>
    <h3>Cosa ho guardato</h3>
    <ul>${m.controlli.map((c) => `<li><strong>${esc(c.etichetta ? c.etichetta.replace(/\.$/, "") : RULE_PLAIN[c.regola] || c.regola)}</strong>: ${(c.etichetta ? ESITO_DOC : ESITO)[c.esito] || ""}<br>
      <span class="small">Dove: ${esc(c.dove_ho_guardato)} · <a href="${esc(m.fonti?.[c.regola] || SRC.form)}" target="_blank" rel="noopener">regola ${esc(c.regola)} del Comune</a></span></li>`).join("")}</ul>
    <h3>Cosa non ho guardato</h3>
    <ul>${notLooked.map((t) => `<li>${t}</li>`).join("")}<li>Il documento non è stato conservato.</li></ul>
    <h3>Chi decide</h3>
    <p>Decide l'<strong>ufficio del Comune</strong>. Io controllo solo che il documento sia completo. Posso sbagliare: quando non sono sicuro, te lo dico.</p>`);
}

// step list shown while a check runs; steps only get a result when the real answer arrives
function progress(steps) {
  const el = addMsg("bot", `<p>Lo sto controllando… 🔎</p><ol class="steps"><li class="done">✓ Ricevuto</li></ol>`);
  const ol = el.querySelector("ol");
  let shown = 0, stopped = false;
  const add = () => {
    if (shown >= steps.length) return;
    const li = document.createElement("li");
    li.textContent = `⏳ ${steps[shown++].label}…`;
    ol.appendChild(li); speak(li.textContent);
  };
  add();
  const timer = setInterval(() => (stopped ? clearInterval(timer) : add()), 2500);
  const end = (lastText, mark) => {
    stopped = true; clearInterval(timer);
    while (shown < steps.length) add();
    [...ol.children].slice(1).forEach((li, i) => { li.textContent = `${mark(steps[i])} ${steps[i].label}`; li.className = "done"; });
    const li = document.createElement("li");
    li.textContent = lastText; li.className = "done"; ol.appendChild(li);
    $("chat").scrollTop = $("chat").scrollHeight;
  };
  return {
    ok: (mark, lastText = "✓ Fatto: il controllo automatico non ha tenuto il documento") => end(lastText, mark),
    fail: () => end("⚠️ Il controllo non è riuscito: non ho un risultato.", () => "–"),
  };
}

// same ids as DOC_CHECKS in rules.py: the labels are shown while the check runs
const DOC_STEPS = {
  id_front: [{ id: "tipo", label: "Guardo che sia un documento d'identità" }, { id: "lato", label: "Guardo che sia il davanti" }, { id: "leggibile", label: "Guardo che si legga bene" }],
  id_back: [{ id: "tipo", label: "Guardo che sia un documento d'identità" }, { id: "lato", label: "Guardo che sia il retro" }, { id: "leggibile", label: "Guardo che si legga bene" }],
  photo: [{ id: "persona", label: "Guardo che si veda bene il viso" }, { id: "colori", label: "Guardo che sia a colori" }, { id: "originale", label: "Guardo che non sia la foto di uno schermo" }],
  delega: [{ id: "modulo", label: "Guardo che sia la delega giusta" }, { id: "compilata", label: "Guardo che sia compilata" }, { id: "firma", label: "Cerco la firma" }],
  nomina: [{ id: "tipo", label: "Guardo che sia un atto di nomina" }, { id: "leggibile", label: "Guardo che si legga bene" }],
};
// stamp for the first failed check: says what to fix, in 1-3 words
const DOC_STAMP = { tipo: "DOCUMENTO SBAGLIATO", modulo: "DOCUMENTO SBAGLIATO", lato: "LATO SBAGLIATO", leggibile: "NON SI LEGGE",
  persona: "VISO NON CHIARO", colori: "SERVE A COLORI", originale: "RIFAI LA FOTO", compilata: "DA COMPLETARE", firma: "MANCA LA FIRMA" };
const ICON = { trovato: "✅", manca: "❌", non_sicuro: "❓" };

const checksList = (m) => `<ul>${m.controlli.map((c) => `<li>${ICON[c.esito]} ${esc(c.spiegazione)}${c.esito !== "trovato" ? `<br><strong>Cosa fare:</strong> ${esc(c.cosa_fare)}` : ""}<br><span class="small">Ho guardato: ${esc(c.dove_ho_guardato)} · regola ${esc(c.regola)}</span></li>`).join("")}</ul>
  <p class="small">È un controllo di completezza: la decisione è dell'ufficio.</p>`;

function medicalSteps() {
  const ref = renewalCert() ? { rule: "R6", label: "Cerco la frase esatta che chiede il Comune" } : { rule: "R4", label: "Cerco il riferimento che chiede il Comune" };
  return [{ rule: "R5", label: "Guardo se ci sono tutte le pagine" }, ref];
}

async function openDesk() {
  S.stage = "desk"; renderTable();
  const n = slots().length;
  await bot(`<p>Ecco la tua busta 📨 sul tavolo. Ci vanno <strong>${n} documenti</strong>.</p><p>Li mettiamo dentro uno alla volta. Ogni volta che ne metti uno, lo guardo e ci metto un timbro.</p>`);
  nextSlot();
}

function nextSlot() {
  const s = slots().find((x) => !S.files[x.id]);
  if (!s) return allDocs();
  promptSlot(s.id);
}

async function promptSlot(id) {
  const pick = (label = "📷 Fotografa o scegli il file") => ({ label, do: () => pickFile(id) });
  const demo = (label, file) => ({ label, soft: true, echo: false, do: () => loadDemo(id, file) });
  const fake = { label: "Usa un esempio (finto)", soft: true, echo: false, do: () => useSpecimen(id) };
  const later = { label: "Lo metto dopo", soft: true, do: () => skip(id) };
  const see = { label: "👀 Fammi vedere un esempio", soft: true, keep: true, echo: false, kw: ["fammi vedere", "giusto", "sbagliato"], do: () => showExample(id) };
  if (id === "medical") {
    await bot((S.request === "rinnovo" && S.permanent
      ? `<p>Cominciamo dal più importante: il <strong>certificato del medico di famiglia</strong>, oppure il verbale con "esonero da future revisioni".</p>`
      : `<p>Cominciamo dal più importante: il <strong>verbale INPS</strong>.</p><p>Servono <strong>tutte le pagine</strong>. Puoi fotografarle una per una: le unisco io.</p>`
      ) + transparency(id));
    return chips([pick(), see, demo("Esempio: verbale di 1 sola pagina", "A_lucia_verbale_solo_pagina5.pdf"),
      demo("Esempio: certificato generico del medico", "B_giorgio_certificato_generico.png"),
      demo("Esempio: certificato giusto del medico", "B2_giorgio_certificato_corretto.png"),
      demo("Esempio: verbale completo", "C_verbale_completo_fittizio.pdf")]);
  }
  const text = {
    idFront: `<p>Ora il <strong>documento d'identità</strong> di ${holder()}: il <strong>davanti</strong>.</p>`,
    idBack: `<p>E adesso il <strong>retro</strong> dello stesso documento.</p>`,
    photo: `<p>Ora la <strong>fototessera</strong>. Va bene anche una foto fatta col telefono, su sfondo chiaro: la taglio io nella misura giusta.</p>`,
    reqFront: `<p>Visto che fai la domanda per un'altra persona, serve anche <strong>il tuo documento</strong>: il davanti.</p>`,
    reqBack: `<p>E il <strong>retro</strong> del tuo documento.</p>`,
    nomina: `<p>Ultima cosa: il <strong>decreto del giudice</strong> che ti ha nominato.</p>`,
  }[id];
  if (id === "delega") {
    await bot(`<p>Manca la <strong>delega</strong>. Te la preparo io già compilata: la persona deve solo <strong>firmarla</strong>. Poi la fotografi.</p>` + transparency(id));
    return chips([{ label: "📝 Preparami la delega", keep: true, do: openDelegaSheet }, pick("📷 Ho la delega firmata"), see, fake, later]);
  }
  await bot(text + transparency(id));
  chips([pick(), see, fake, later]);
}

async function skip(id) {
  S.files[id] = { skipped: true, status: "warn", stamp: "MANCA" };
  renderTable();
  await bot("Va bene, lo lasciamo per dopo. Tocca il foglio sul tavolo quando ce l'hai.");
  nextSlot();
}

function pickFile(id) {
  const p = $("picker");
  p.value = "";
  p.accept = id === "photo" ? "image/*,.heic" : "image/*,.heic,application/pdf";
  p.multiple = ["medical", "summary", "nomina"].includes(id); // several pages are merged into one PDF
  p.onchange = () => p.files.length && receive(id, [...p.files]);
  p.click();
}

async function loadDemo(id, file) {
  let blob;
  try { blob = await Connectors.backend.demoFile(file); } catch (e) { return bot(`<p>${esc(e.message)}</p>`); }
  addMsg("me", `📎 ${esc(file)}`);
  receive(id, [new File([blob], file, { type: blob.type })], true);
}

async function useSpecimen(id) {
  addMsg("me", "📎 esempio finto");
  receive(id, [await specimen(id)], true);
}

async function receive(id, files, demo = false) {
  if (id === "summary") return receiveSummary(files, demo);
  S.files[id] = { status: "scanning" };
  renderTable();
  let prepared;
  try {
    prepared = await prepare(id, files);
  } catch (e) {
    S.files[id] = null; delete S.files[id]; renderTable();
    await bot(`<p>Non riesco a usare questo file: ${esc(e.message)}</p>`);
    return promptSlot(id);
  }
  const f = { ...prepared, demo, demoName: demo ? files[0].name : undefined, url: URL.createObjectURL(prepared.blob) };
  if (id !== "medical") {
    f.status = prepared.grey ? "warn" : "ok";
    f.stamp = prepared.grey ? "SERVE A COLORI" : "PRONTO";
    S.files[id] = f; renderTable();
    await bot(`<p>${prepared.grey ? "⚠️" : "✅"} ${esc(prepared.note || "Fatto, è nella busta.")}</p>`);
    if (S.consent === null) return askConsent(id);
    if (S.consent === "check") return checkDoc(id);
    return afterLocal(id);
  }
  f.status = "scanning"; S.files[id] = f; renderTable();
  if (prepared.note) await bot(`<p>${esc(prepared.note)}</p>`);
  const steps = medicalSteps(), prog = progress(steps);
  try {
    S.medical = await Connectors.backend.checkMedical({ case: { request_type: S.request, permanent: S.permanent }, files: [await forClaude(f)] });
  } catch (e) {
    prog.fail();
    f.status = "warn"; f.stamp = "DA RIPROVARE"; renderTable();
    await bot(`<p>${esc(e.message)}</p>`);
    return chips([{ label: "Riprova", do: () => receive(id, files, demo) }, { label: "Vado avanti", soft: true, do: nextSlot }]);
  }
  const icon = { trovato: "✅", manca: "❌", non_sicuro: "❓" };
  prog.ok((st) => icon[S.medical.controlli.find((c) => c.regola === st.rule)?.esito] || "–");
  medicalVerdict(f);
}

// local result only (no consent): the colour check on the photo is the one thing that can be fixed here
function afterLocal(id) {
  if (id === "photo" && S.files.photo?.status === "warn") return chips([{ label: "📷 Rifaccio la foto", do: () => pickFile("photo") }, { label: "Va bene così", soft: true, do: nextSlot }]);
  return nextSlot();
}

// asked once, at the first attachment after the medical document; the answer holds for the whole envelope
async function askConsent(id) {
  await bot(`<p>Vuoi che controlli anche <strong>documento d'identità, foto e delega</strong>?</p>
    <p>Li legge Claude, un'intelligenza artificiale. Guarda solo se è il lato giusto, se si legge e se c'è la firma. <strong>Non copia nomi, numeri o date</strong> e non salva niente.</p>
    <p class="small">Se preferisci, restano solo sul tuo telefono o computer: li sistemo io qui, senza controllo.</p>`);
  chips([
    { label: "🔎 Sì, controllali", yes: true, kw: ["sì", "si", "controlla"], do: () => { S.consent = "check"; renderTable(); checkDoc(id); } },
    { label: "🔒 No, restano qui", no: true, kw: ["no", "restano", "qui"], do: () => { S.consent = "local"; renderTable(); afterLocal(id); } },
  ]);
}

async function checkDoc(id) {
  const f = S.files[id];
  const local = { status: f.status, stamp: f.stamp };
  f.status = "scanning"; renderTable();
  const steps = DOC_STEPS[KIND[id]], prog = progress(steps);
  try {
    f.check = await Connectors.backend.checkDocument({ kind: KIND[id], files: [await forClaude(f)] });
  } catch (e) {
    prog.fail();
    Object.assign(f, local); renderTable();
    await bot(`<p>${esc(e.message)}</p><p>Il file resta comunque nella busta.</p>`);
    return chips([{ label: "Riprova il controllo", do: () => checkDoc(id) }, { label: "Vado avanti", soft: true, do: nextSlot }]);
  }
  prog.ok((st) => ICON[f.check.controlli.find((c) => c.controllo === st.id)?.esito] || "–");
  docVerdict(id, f);
}

async function docVerdict(id, f) {
  const m = f.check;
  const failed = m.controlli.find((c) => c.esito === "manca");
  f.status = { sembra_completo: "ok", manca_qualcosa: "bad", da_verificare: "warn" }[m.esito_generale];
  f.stamp = f.status === "ok" ? "VA BENE" : f.status === "warn" ? "DA VERIFICARE" : DOC_STAMP[failed?.controllo] || "DA SISTEMARE";
  renderTable();
  await bot(`<p><strong>${esc(m.messaggio)}</strong></p>`, checksList(m));
  const how = addMsg("bot", `<p><button class="chip soft" type="button">🔎 Come ho controllato?</button></p>`);
  how.querySelector("button").addEventListener("click", () => howChecked(m, id));
  if (f.status === "ok") return nextSlot();
  const list = [];
  if (id === "delega") list.push({ label: "📝 Preparami la delega", keep: true, do: openDelegaSheet });
  list.push({ label: id === "photo" ? "📷 Rifaccio la foto" : "📷 Lo rifotografo", do: () => pickFile(id) });
  list.push({ label: "Vado avanti, lo sistemo dopo", soft: true, do: nextSlot });
  chips(list);
}

async function medicalVerdict(f) {
  const m = S.medical;
  const pagesMissing = m.controlli.some((c) => c.regola === "R5" && c.esito === "manca");
  f.status = { sembra_completo: "ok", manca_qualcosa: "bad", da_verificare: "warn" }[m.esito_generale];
  f.stamp = f.status === "ok" ? "VA BENE" : f.status === "warn" ? "DA VERIFICARE" : m.serve_lettera_medico ? "MANCA LA FRASE" : pagesMissing ? "MANCANO PAGINE" : "MANCA QUALCOSA";
  renderTable();
  await bot(`<p><strong>${esc(m.messaggio)}</strong></p>`, checksList(m));
  const how = addMsg("bot", `<p><button class="chip soft" type="button">🔎 Come ho controllato?</button></p>`);
  how.querySelector("button").addEventListener("click", () => howChecked(m));
  if (f.status === "ok") return nextSlot();
  const list = [];
  if (m.serve_lettera_medico) list.push({ label: "🩺 Preparami la lettera per il medico", keep: true, do: printDoctorLetter });
  list.push({ label: m.serve_lettera_medico ? "📷 Ho il certificato nuovo" : "📷 Carico il documento completo", do: () => pickFile("medical") });
  list.push({ label: "Vado avanti, lo sistemo dopo", soft: true, do: nextSlot });
  chips(list);
}

async function allDocs() {
  const all = slots().every((s) => S.files[s.id]?.status === "ok");
  S.stage = "desk"; renderTable(all);
  await bot(all ? "<p>🎉 <strong>La busta è completa!</strong> Ho chiuso la busta con il sigillo.</p>"
    : "<p>La busta è quasi pronta. I fogli con il timbro rosso o giallo sono da sistemare: puoi toccarli quando vuoi.</p>");
  askGoOut();
}

async function askGoOut() {
  await bot(`<p>Due domande pratiche. ${S.role === "self" ? "Puoi andare" : "La persona può andare"} di persona in <strong>via Sile 8</strong> (metro Brenta o Corvetto) a ritirare il pass?</p>`);
  chips([{ label: "Sì, senza problemi", yes: true, do: () => { S.canGoOut = "yes"; askCar(); } },
    { label: "No, è difficile", no: true, kw: ["difficile", "non può", "casa"], do: () => { S.canGoOut = "no"; bot("Allora sceglieremo la <strong>raccomandata a casa</strong>."); askCar(); } }]);
}

async function askCar() {
  await bot("<p>C'è un'<strong>auto</strong> che usa di solito? Serve per entrare in ZTL e Area B e C.</p>");
  chips([
    { label: "Sì, scrivo la targa", yes: true, do: askPlate },
    { label: "No, oppure dopo", no: true, kw: ["dopo", "nessuna"], do: () => { S.car = "later"; offerGuide(); } },
  ]);
}

async function askPlate() {
  const el = addMsg("bot", `<p>Scrivi la targa (resta qui, non la mando a nessuno):</p>
    <div class="inline-input"><input id="plate" aria-label="Targa" autocomplete="off" placeholder="AB123CD"><button id="plate-ok">OK</button></div>`);
  const input = el.querySelector("#plate");
  input.focus();
  const done = () => {
    S.plate = input.value.toUpperCase().replace(/\s/g, ""); S.car = "yes";
    el.querySelector(".inline-input").innerHTML = `<strong>${esc(S.plate || "—")}</strong>`;
    offerGuide();
  };
  el.querySelector("#plate-ok").addEventListener("click", done);
  input.addEventListener("keydown", (e) => e.key === "Enter" && done());
}

async function offerGuide() {
  await bot(`<p>Perfetto. Ora apri il <strong>modulo del Comune</strong> (ti serve SPID, CIE o eIDAS).</p><p>Io ti mostro <strong>ogni schermata</strong> e ti indico dove toccare. I file pronti li trovi toccando i fogli sul tavolo.</p>`);
  chips([{ label: "🌐 Apri il modulo del Comune", keep: true, echo: false, do: () => window.open(SRC.form, "_blank", "noopener") },
    { label: "Accompagnami ▶", kw: ["accompagna", "avanti", "andiamo"], yes: true, do: () => guide(1) }]);
}

// ===================================================================================== guide through the real form

function guideStep(n) {
  const role = ROLES[S.role].official, name = (k) => esc(S.files[k]?.name || `${FILE_NAMES[k]}.jpg`);
  const field = (label, value, hot) => `<div class="r-field"><label>${label}</label><div class="r-input ${hot ? "hot" : ""}">${value}${hot ? '<span class="hand" aria-hidden="true">👈</span>' : ""}</div></div>`;
  const check = (text, hot) => `<div class="r-field"><div class="r-input ${hot ? "hot" : ""}" style="border:0"><span class="r-check"></span>${text}${hot ? '<span class="hand" aria-hidden="true">👈</span>' : ""}</div></div>`;
  const steps = {
    1: { panel: check("di aver letto e compreso quanto indicato nell'informativa", true),
      say: `Spunta la casella <strong class="v">di aver letto e compreso</strong> e premi <strong>SALVA & PROSEGUI</strong>.` },
    2: { panel: field("Richiedo il pass disabili in qualità di", esc(role), true),
      say: `Apri il menu e scegli <strong class="v">${esc(role)}</strong>.` },
    3: { panel: field("Nome *", "", false) + field("Cognome *", "", false) + field("Codice Fiscale *", "", false) +
        field("Telefono\\Cellulare *", "", true) + field("Email *", "", true) +
        field("Documento FRONTE *", `📎 ${name("idFront")}`, true) + field("Documento RETRO *", `📎 ${name("idBack")}`, true) + field("Fotografia 35×45 *", `📎 ${name("photo")}`, true),
      say: `Scrivi nome, cognome e codice fiscale di ${holder()}.<br>📞 <strong>Attenzione:</strong> al telefono e all'email arriveranno <strong>tutte le comunicazioni</strong>.${other() ? " Se la persona non usa l'email, puoi mettere la tua." : ""}<br>Poi allega i file che ti ho preparato (toccali sul tavolo per scaricarli). Se il modulo chiede anche ${other() ? "il tuo documento, " : ""}${S.role === "delegate" ? "la delega, " : ""}il documento sanitario, usa <strong>${name("medical")}</strong>.` },
    4: { panel: field("Il\\La sottoscritto\\a chiede:", S.request === "rinnovo" ? "il rinnovo del pass disabili" : "il rilascio di un nuovo pass disabili", true),
      say: `Scegli <strong class="v">${S.request === "rinnovo" ? "il rinnovo del pass disabili" : "il rilascio di un nuovo pass disabili"}</strong>.` },
    5: { panel: check("di conoscere e acconsentire a quanto riportato sopra", true),
      say: `Qui dichiari che il pass è <strong>personale</strong> e che, quando scade, va distrutto o riconsegnato. Spunta la casella.` },
    6: { panel: field("Modalità di ritiro del pass:", S.canGoOut === "no" ? "invio presso il domicilio … a mezzo raccomandata" : "raccomandata oppure ritiro di persona", true),
      say: S.canGoOut === "no" ? `Scegli <strong class="v">invio a domicilio con raccomandata</strong>: mi hai detto che andare in ufficio è difficile.<br>⚠️ <strong>Dopo l'invio questa scelta non si cambia.</strong>`
        : `Scegli come preferisci. ⚠️ <strong>Dopo l'invio questa scelta non si cambia.</strong>` },
    7: S.car === "yes"
      ? { panel: check("voler richiedere l'autorizzazione per il libero transito in ZTL, Area C, Area B…", true) + field("TARGA", esc(S.plate), true) +
          check("aderire / NON aderire alla Piattaforma nazionale CUDE", true),
        say: `Spunta la prima casella e scrivi la targa <strong class="v">${esc(S.plate)}</strong>.<br>Poi scegli se aderire alla <strong>Piattaforma nazionale</strong>: con l'adesione la targa vale anche nelle ZTL di altri Comuni aderenti. <strong>Una delle due va spuntata.</strong>` }
      : { panel: check("voler proseguire senza associare la targa", true), say: `Spunta <strong class="v">voler proseguire senza associare la targa</strong>. La potrai aggiungere più avanti.` },
    8: { panel: `<p>Riepilogo di tutte le schede…</p><div class="r-buttons" style="padding:0"><span class="r-btn ghost hot">🖨 STAMPA RIEPILOGO DATI<span class="hand">👈</span></span><span class="r-btn" style="opacity:.4">✋ CONFERMA DATI</span></div>`,
      say: `✋ <strong>Non premere ancora CONFERMA.</strong> Fai uno screenshot del riepilogo (o premi STAMPA) e <strong>mostramelo</strong>: facciamo la prova generale.` },
    9: { panel: `<div class="r-buttons" style="padding:0"><span></span><span class="r-btn hot">CONFERMA DATI E PROSEGUI<span class="hand">👈</span></span></div>`, say: `Ora puoi premere <strong>CONFERMA DATI E PROSEGUI</strong>.` },
    10: { panel: `<div class="r-buttons" style="padding:0"><span></span><span class="r-btn hot">INOLTRA<span class="hand">👈</span></span></div>`,
      say: `Premi <strong>INOLTRA</strong>. L'ufficio ha <strong>30 giorni</strong> per rispondere (nel 2025, in media proprio 30). Ti scriveranno ai contatti della scheda 3.` },
  };
  return steps[n];
}

async function guide(n) {
  S.stage = "guide"; S.tab = n; renderTable();
  const step = guideStep(n);
  await bot(`<p><strong>Schermata ${n}: ${TABS[n - 1]}</strong></p><p>${step.say}</p>`);
  if (n === 8) return chips([
    { label: "📷 Ti mostro il riepilogo", do: () => pickFile("summary") },
    { label: "Esempio: riepilogo di Lucia", soft: true, echo: false, do: () => loadDemo("summary", "D_lucia_riepilogo_modulo.png") },
    { label: "Perché serve?", soft: true, keep: true, echo: false, do: () => bot(`<p>${esc(why("summary"))}</p>${transparency("summary").split("<details")[0]}`) },
    { label: "← Indietro", soft: true, do: () => guide(7) }]);
  if (n === 10) return chips([{ label: "📋 Rivedi il riepilogo", soft: true, keep: true, echo: false, do: openRecap }, { label: "✓ Fatto, ho inviato!", do: finish }, { label: "← Indietro", soft: true, do: () => guide(9) }]);
  chips([...(n === 9 ? [{ label: "📋 Rivedi il riepilogo", soft: true, keep: true, echo: false, do: openRecap }] : []),
    { label: "✓ Fatto, avanti", yes: true, kw: ["fatto", "avanti", "ok"], do: () => guide(n + 1) },
    { label: "🔁 Ripeti", soft: true, kw: ["ripeti"], do: () => guide(n) },
    ...(n > 1 ? [{ label: "← Indietro", soft: true, kw: ["indietro"], do: () => guide(n - 1) }] : [])]);
}

async function receiveSummary(files, demo = false) {
  let prepared;
  try { prepared = await prepare("summary", files); } catch (e) { return bot(`<p>${esc(e.message)}</p>`); }
  S.rehearsal = { scanning: true }; renderTable();
  await bot(`<p class="small">${where("summary")}. Non leggo nome e codice fiscale.</p>`);
  const prog = progress([{ label: "Guardo chi fa la domanda e che tipo di richiesta è" }, { label: "Guardo consegna e targa" }, { label: "Guardo se mancano allegati" }]);
  try {
    S.rehearsal = await Connectors.backend.checkSummary({
      context: { role_label: ROLES[S.role].official, request_label: S.request === "rinnovo" ? "rinnovo" : "primo rilascio",
        can_go_out: S.canGoOut === "no" ? "no, è difficile" : "sì", car: S.car === "yes" ? "sì, vuole associare la targa" : "no o più avanti",
        medical_outcome: S.medical?.esito_generale || "non fatto" },
      files: [await forClaude({ ...prepared, demoName: demo ? files[0].name : undefined })], // real file names may contain people's names
    });
  } catch (e) {
    S.rehearsal = null; renderTable(); prog.fail();
    await bot(`<p>${esc(e.message)}</p>`);
    return chips([{ label: "Riprova", do: () => receiveSummary(files) }]);
  }
  renderTable(); prog.ok(() => "✓", "✓ Fatto: il controllo automatico non ha tenuto lo screenshot");
  const r = S.rehearsal;
  await bot(`<p><strong>${esc(r.messaggio)}</strong></p>`);
  if (r.pronto_per_inoltro) return chips([{ label: "Vai a Conferma e Inoltra ▶", yes: true, do: () => guide(9) }]);
  await bot(`<ul>${r.problemi.map((p) => `<li>${p.gravita === "blocca" ? "🛑" : "⚠️"} <strong>${esc(p.scheda)}</strong>: ${esc(p.problema)}<br><strong>Cosa fare:</strong> ${esc(p.cosa_fare)}</li>`).join("")}</ul>`);
  chips([{ label: "📷 Ho corretto, ricontrolla", do: () => pickFile("summary") },
    { label: "Esempio: ricontrolla", soft: true, echo: false, do: () => loadDemo("summary", "D_lucia_riepilogo_modulo.png") },
    { label: "Vado avanti comunque", soft: true, do: () => guide(9) }]);
}

async function finish() {
  S.stage = "done"; renderTable(true);
  await bot(`<p>🎉 <strong>Bravissimo!</strong> La domanda è partita.</p><p>Ora l'ufficio la controlla: ha 30 giorni. Se manca qualcosa, ti scrivono.</p>`,
    `<p>Ultima cosa importante: premi <strong>"Cancella tutto"</strong> così sul dispositivo non resta nessun documento.</p>`);
  chips([{ label: "📋 Rivedi il riepilogo", keep: true, echo: false, do: openRecap }, { label: "📋 Scheda per l'ufficio", keep: true, do: openOfficeSheet }, { label: "🏢 Preferisco andare di persona", soft: true, keep: true, echo: false, do: openOffice }, { label: "🗑️ Cancella tutto", do: wipe }]);
}

// ===================================================================================== the table (right side)

function renderTable(sealed = false) {
  const t = $("table");
  if (S.stage === "welcome") {
    t.innerHTML = `<h2>Il tuo tavolo</h2><p class="sub">Qui appariranno la busta e i documenti.</p>
      <div class="envelope"><span class="label">La tua busta per il Comune</span><div class="slots">
      ${["🩺", "🪪", "🙂", "✍️"].map((i) => `<div class="doc empty" aria-hidden="true"><span class="icon">${i}</span></div>`).join("")}</div></div>`;
    return;
  }
  if (S.stage === "guide") return renderGuide(t);
  const list = slots();
  const done = list.filter((s) => S.files[s.id]?.status === "ok").length;
  t.innerHTML = `<h2>${S.stage === "done" ? "Domanda inviata 📮" : "La tua busta"}</h2>
    <p class="sub">${done} di ${list.length} documenti pronti · tocca un foglio per caricarlo, vederlo o scaricarlo</p>
    <div class="envelope ${sealed ? "sealed" : ""}"><span class="label">Pass disabili · Comune di Milano</span><span class="seal" aria-label="Busta sigillata">PRONTA</span>
      <div class="slots">${list.map(card).join("")}</div></div>
    <p class="sub legend">${[...new Set([where("idFront"), where("medical")])].join(" · ")}</p>
    <div class="under">${S.medical?.serve_lettera_medico ? `<button class="chip" data-act="letter">🩺 Lettera per il medico</button>` : ""}
      ${S.role === "delegate" ? `<button class="chip" data-act="delega">📝 Delega da firmare</button>` : ""}
      ${S.stage !== "welcome" && S.canGoOut ? `<button class="chip" data-act="guide">🧭 Accompagnami nel modulo</button>` : ""}
      ${S.medical ? `<button class="chip" data-act="office">📋 Scheda per l'ufficio</button>` : ""}</div>`;
  t.querySelectorAll(".doc").forEach((d) => d.addEventListener("click", () => openCard(d.dataset.slot)));
  t.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => ({ letter: printDoctorLetter, delega: openDelegaSheet, guide: () => guide(S.tab || 1), office: openOfficeSheet })[b.dataset.act]()));
}

const badge = (id) => `<span class="where-badge" aria-hidden="true">${goesToCheck(id) ? "🔎" : "🔒"}</span>`;

function card(s) {
  const f = S.files[s.id];
  if (!f || f.skipped && !f.blob) {
    return `<button class="doc empty" data-slot="${s.id}" aria-label="${esc(s.name)} ${esc(s.hint)}: da caricare. ${where(s.id).slice(3)}">${badge(s.id)}
      <span class="icon">${s.icon}</span><span class="name">${esc(s.name)}</span><span class="hint">${esc(s.hint)}</span>
      ${f?.skipped ? `<span class="stamp warn">MANCA</span>` : ""}</button>`;
  }
  const img = f.blob && f.blob.type.startsWith("image/") && s.id === "photo" ? `<img class="preview" src="${f.url}" alt="">` : `<span class="lines"></span>`;
  return `<button class="doc filled" data-slot="${s.id}" aria-label="${esc(s.name)} ${esc(s.hint)}: ${esc(f.stamp || "in controllo")}. ${where(s.id).slice(3)}">${badge(s.id)}
    <span class="icon">${s.icon}</span><span class="name">${esc(s.name)}</span><span class="hint">${esc(s.hint)}</span>${img}
    ${f.status === "scanning" ? `<span class="scan" aria-hidden="true"></span>` : `<span class="stamp ${f.status}">${esc(f.stamp)}</span>`}</button>`;
}

function renderGuide(t) {
  const step = guideStep(S.tab);
  const r = S.rehearsal;
  t.innerHTML = `<h2>Così vedrai il modulo del Comune</h2><p class="sub">Schermata ${S.tab} di 10 · il riquadro giallo è dove toccare</p>
    <div class="replica" aria-hidden="true"><div class="r-top"></div><div class="r-head">Comune di Milano</div>
      <div class="r-title">Richiesta pass per la sosta e la circolazione di persone con disabilità (CUDE)</div>
      <div class="r-tabs">${TABS.map((x, i) => `<span class="${i + 1 === S.tab ? "on" : ""}">${i + 1}. ${x}</span>`).join("")}</div>
      <div class="r-body"><h3>${S.tab}. ${TABS[S.tab - 1]}</h3><div class="r-panel">${step.panel}</div></div>
      <div class="r-buttons">${S.tab > 1 ? `<span class="r-btn">◀ INDIETRO</span>` : "<span></span>"}<span class="r-btn ghost">SALVA BOZZA</span><span class="r-btn">SALVA & PROSEGUI ▶</span></div>
    </div>
    <div class="callout" data-speak>${step.say}</div>
    ${S.tab === 8 && r && !r.scanning ? `<div class="slots" style="margin-top:16px">${r.problemi.map((p) => `<div class="doc filled" style="aspect-ratio:auto;min-height:150px">
      <span class="name">${esc(p.scheda)}</span><span class="hint">${esc(p.problema)}</span><span class="stamp ${p.gravita === "blocca" ? "bad" : "warn"}" style="position:static;transform:rotate(-8deg);margin-top:6px">${p.gravita === "blocca" ? "DA SISTEMARE" : "ATTENZIONE"}</span></div>`).join("")}
      ${r.pronto_per_inoltro ? `<div class="doc filled" style="aspect-ratio:auto;min-height:150px"><span class="icon">📨</span><span class="stamp ok" style="position:static;transform:rotate(-8deg)">PRONTA DA INVIARE</span></div>` : ""}</div>` : ""}
    ${S.tab === 8 && r?.scanning ? `<div class="doc filled" style="aspect-ratio:auto;min-height:120px;margin-top:16px"><span class="name">Sto controllando il riepilogo…</span><span class="scan"></span></div>` : ""}
    <div class="guide-nav"><button class="chip soft" data-act="desk">📨 Torna alla busta</button>
      <a class="chip soft" href="${SRC.form}" target="_blank" rel="noopener">🌐 Apri il modulo vero</a></div>`;
  t.querySelector("[data-act=desk]").addEventListener("click", () => { S.stage = "desk"; renderTable(slots().every((s) => S.files[s.id]?.status === "ok")); });
}

function openCard(id) {
  const f = S.files[id];
  const s = slots().find((x) => x.id === id);
  if (!f || !f.blob) { addMsg("me", `${s.icon} ${esc(s.name)}`); return promptSlot(id); }
  const m = id === "medical" ? S.medical : f.check;
  sheet(`${s.icon} ${s.name} (${s.hint})`, `
    <p><strong>File pronto per il modulo:</strong> ${esc(f.name)} · ${(f.blob.size / 1048576).toFixed(1)} MB</p>
    ${f.note ? `<p>${esc(f.note)}</p>` : ""}
    ${m ? `<ul>${m.controlli.map((c) => `<li>${ICON[c.esito]} ${esc(c.spiegazione)}</li>`).join("")}</ul>` : ""}
    <p><a class="chip" href="${f.url}" download="${esc(f.name)}">⬇️ Scarica il file</a>
    <button class="chip soft" id="replace">🔄 Sostituisci</button>
    <button class="chip soft" id="see-ex">👀 Fammi vedere un esempio</button>
    ${m ? `<button class="chip soft" id="how">🔎 Come ho controllato?</button>` : ""}
    ${KIND[id] && !m && f.status !== "scanning" ? `<button class="chip soft" id="check-now">🔎 Fammelo controllare</button>` : ""}</p>
    ${transparency(id)}
    <p class="small">${m ? "Questo documento è stato letto da Claude solo per il controllo, e non è stato salvato." : "Questo file non è mai uscito dal tuo dispositivo."}</p>`);
  $("replace").addEventListener("click", () => { $("sheet").close(); pickFile(id); });
  $("see-ex").addEventListener("click", () => showExample(id));
  $("how")?.addEventListener("click", () => howChecked(m, id));
  $("check-now")?.addEventListener("click", () => { $("sheet").close(); addMsg("me", `🔎 ${esc(s.name)} (${esc(s.hint)})`); checkDoc(id); });
}

// ===================================================================================== local file processing

const isHeic = (f) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
async function toJpeg(file) {
  if (!isHeic(file)) return file;
  const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}
function loadImage(blob) {
  return new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => fail(new Error("l'immagine non si apre")); img.src = URL.createObjectURL(blob); });
}
async function shrink(blob, maxSide = 2200) {
  const img = await loadImage(blob);
  let side = maxSide, q = 0.88, out = blob;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    out = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q));
    if (out.size <= MAX_BYTES * 0.9) break;
    side *= 0.8; q -= 0.08;
  }
  return out;
}
async function passportPhoto(blob) {
  const img = await loadImage(blob);
  const ratio = 35 / 45, w = img.naturalWidth, h = img.naturalHeight;
  let cw = w, ch = w / ratio;
  if (ch > h) { ch = h; cw = h * ratio; }
  const c = document.createElement("canvas");
  c.width = 413; c.height = 531;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let sat = 0;
  for (let i = 0; i < px.length; i += 16) { const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]); sat += mx ? (mx - mn) / mx : 0; }
  const grey = sat / (px.length / 16) < 0.06;
  return { blob: await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92)), grey,
    note: grey ? "La foto sembra in bianco e nero: il Comune la vuole a colori." : "Ho tagliato la foto nella misura giusta (35×45 mm)." };
}
async function imagesToPdf(blobs) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  for (let i = 0; i < blobs.length; i++) {
    const img = await loadImage(blobs[i]);
    const r = Math.min(200 / img.naturalWidth, 287 / img.naturalHeight);
    if (i) pdf.addPage();
    pdf.addImage(await dataUrl(blobs[i]), "JPEG", 5, 5, img.naturalWidth * r, img.naturalHeight * r);
  }
  return pdf.output("blob");
}
const dataUrl = (b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });

async function prepare(id, files) {
  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length && files.length > 1) throw new Error("carica un solo PDF, oppure solo foto.");
  if (pdfs.length) {
    if (pdfs[0].size > MAX_BYTES) throw new Error("il PDF supera 5 MB e il Comune non lo accetta. Prova a fotografare le pagine: le unisco io.");
    return { blob: pdfs[0], name: `${FILE_NAMES[id]}.pdf`, note: "" };
  }
  const heic = files.some(isHeic);
  const imgs = [];
  for (const f of files) imgs.push(await shrink(await toJpeg(f)));
  const conv = heic ? "Ho convertito la foto dell'iPhone in un formato che il Comune accetta. " : "";
  if (id === "photo") { const p = await passportPhoto(imgs[0]); return { ...p, name: `${FILE_NAMES[id]}.jpg`, note: conv + p.note }; }
  if (id === "medical" || imgs.length > 1) {
    const blob = await imagesToPdf(imgs);
    if (blob.size > MAX_BYTES) throw new Error("anche unito supera 5 MB. Prova con foto più piccole.");
    return { blob, name: `${FILE_NAMES[id]}.pdf`, note: conv + `Ho unito ${imgs.length === 1 ? "la foto" : `le ${imgs.length} foto`} in un unico PDF.` };
  }
  return { blob: imgs[0], name: `${FILE_NAMES[id]}.jpg`, note: conv + "Fatto, è nella busta." };
}

async function specimen(id) {
  // a clearly fake document for demos: no real data
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (id === "photo") {
    c.width = 600; c.height = 772;
    ctx.fillStyle = "#dbe8f5"; ctx.fillRect(0, 0, 600, 772);
    ctx.fillStyle = "#e8b48f"; ctx.beginPath(); ctx.arc(300, 330, 150, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#6b4a2f"; ctx.beginPath(); ctx.arc(300, 260, 160, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#2e5c8a"; ctx.fillRect(110, 520, 380, 252);
  } else {
    c.width = 1000; c.height = 640;
    ctx.fillStyle = "#eef1f6"; ctx.fillRect(0, 0, 1000, 640);
    ctx.fillStyle = "#1f3b70"; ctx.fillRect(0, 0, 1000, 90);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px Arial";
    ctx.fillText(id === "delega" ? "MODULO DELEGA" : id === "nomina" ? "DECRETO DI NOMINA" : "CARTA D'IDENTITÀ", 30, 60);
    ctx.fillStyle = "#333"; ctx.font = "30px Arial";
    ["Cognome: ESEMPIO", "Nome: PERSONA", "Documento n°: FAC-SIMILE"].forEach((t, i) => ctx.fillText(t, 40, 180 + i * 60));
  }
  ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-0.4);
  ctx.fillStyle = "rgba(200,0,0,.55)"; ctx.font = "bold 70px Arial"; ctx.textAlign = "center"; ctx.fillText("FAC-SIMILE", 0, 0); ctx.restore();
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
  return new File([blob], `esempio_${id}.jpg`, { type: "image/jpeg" });
}

// ===================================================================================== server calls

// all network calls go through static/connectors.js (backend + LangGraph)
async function forClaude(f) {
  const media = f.blob.type === "application/pdf" || f.name.endsWith(".pdf") ? "application/pdf" : f.blob.type || "image/jpeg";
  return { name: f.demoName || f.name, media_type: media, data: (await dataUrl(f.blob)).split(",")[1] };
}

// ===================================================================================== final recap (local only)

const STATUS_WORDS = { ok: "✅ Pronto", warn: "⚠️ Da verificare", bad: "❌ Da sistemare", scanning: "⏳ In controllo" };

function recapMissing() {
  const todo = slots().filter((s) => S.files[s.id]?.status !== "ok").map((s) => {
    const st = S.files[s.id]?.status;
    return `${s.name} (${s.hint}): ${st === "bad" ? "da sistemare, caricalo di nuovo" : st === "warn" ? "da verificare, controlla la nota sulla carta" : "manca, caricalo dal tavolo"}`;
  });
  if (!S.canGoOut) todo.push("Consegna del pass: dimmi se riesci ad andare in ufficio");
  if (S.car === null) todo.push("Targa: dimmi se vuoi associarla");
  if (S.car === "yes" && !S.plate) todo.push("Targa: scrivila nel campo del modulo");
  return todo;
}

function recapHtml() {
  const m = S.medical, r = S.rehearsal && !S.rehearsal.scanning ? S.rehearsal : null, todo = recapMissing();
  const sec = (tab, title, body) => `<h3>${esc(title)} <span class="small">· scheda ${tab}: ${esc(TABS[tab - 1])}</span></h3>${body}`;
  const docs = slots().map((s) => `<li><strong>${esc(s.name)}</strong> (${esc(s.hint)}): ${esc(STATUS_WORDS[S.files[s.id]?.status] || "❌ Manca")}<br><span class="small">${esc(where(s.id))}</span></li>`).join("");
  const delivery = S.canGoOut === "no" ? "Raccomandata a casa."
    : S.canGoOut ? "A scelta: raccomandata oppure ritiro su appuntamento." : "Non ancora scelta.";
  return `<p class="recap-note"><strong>Questo riepilogo resta sul tuo dispositivo. La domanda la invii tu sul sito del Comune.</strong> Non ho inviato nulla al Comune.</p>
    ${todo.length ? `<div class="recap-todo"><strong>Cosa ancora manca</strong><ul>${todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : `<p class="recap-ok">✅ Non manca niente.</p>`}
    ${sec(2, "Chi fa la domanda", `<p>${esc(S.role ? ROLES[S.role].official : "non indicato")}${other() ? ` · per conto ${S.role === "parent" ? "di tuo figlio o tua figlia" : "della persona con disabilità"}` : ""}</p>`)}
    ${sec(4, "Tipo di richiesta", `<p>${esc(requestWord())}${S.request === "rinnovo" ? ` · invalidità permanente: ${S.permanent === true ? "sì" : S.permanent === false ? "no" : "non so"}` : ""}</p>`)}
    <h3>Documenti nella busta</h3><ul>${docs}</ul>
    <h3>Controllo del documento sanitario</h3>${m ? `<p>${esc(m.messaggio)}</p>${m.controlli?.length ? `<ul>${m.controlli.map((c) => `<li>${esc(c.regola)}: ${esc(String(c.esito).replace("_", " "))}</li>`).join("")}</ul>` : ""}` : "<p>Non ancora fatto.</p>"}
    ${sec(6, "Consegna del pass", `<p>${esc(delivery)}</p><p class="small">⚠️ Dopo l'invio questa scelta non si cambia.</p>`)}
    ${sec(7, "Targa", S.car === "yes" ? `<p>Targa: <strong>${esc(S.plate || "da scrivere")}</strong> (resta solo sul tuo dispositivo)</p><p class="small">Ricorda di scegliere se aderire alla Piattaforma nazionale CUDE: una delle due caselle va spuntata.</p>` : "<p>Nessuna targa per ora.</p>")}
    <h3>Prova generale</h3>${r ? (r.pronto_per_inoltro ? `<p>✅ ${esc(r.messaggio)}</p>` : `<p>${esc(r.messaggio)}</p><ul>${r.problemi.map((p) => `<li>${esc(p.scheda)}: ${esc(p.problema)} <em>${esc(p.cosa_fare)}</em></li>`).join("")}</ul>`) : "<p>Non ancora fatta.</p>"}
    ${sec(3, "Contatti", "<p>Tutte le comunicazioni del Comune arrivano al telefono e all'email che scrivi nel modulo: controlla che siano giusti.</p>")}`;
}

function openRecap() {
  sheet("📋 Riepilogo di quello che hai preparato", `<div id="recap">${recapHtml()}</div>
    <p><button class="chip" id="recap-print">🖨️ Stampa il riepilogo</button></p>
    <p class="small">Quando hai finito, premi "🗑️ Cancella tutto" in alto: il riepilogo sparisce dal dispositivo.</p>`);
  $("recap-print").addEventListener("click", () => printWindow("Riepilogo pass disabili", `<h1>Riepilogo di quello che hai preparato</h1>${recapHtml()}`));
}

// ===================================================================================== sheets and printables

function sheet(title, html) {
  $("sheet-title").textContent = title;
  $("sheet-body").innerHTML = html;
  hideEmoji($("sheet-body")); hideEmoji($("sheet-title"));
  if (!$("sheet").open) $("sheet").showModal();
  else $("sheet-title").focus(); // content replaced inside an open sheet: keep focus in the dialog
}

// Office facts, defined once. A future LangGraph chatbot can reuse them: see docs/INTEGRAZIONE-FE-BE.md
const OFFICE = {
  name: "Unità Gestione Permessi", address: "Via Sile 8, 20139 Milano", area: "Municipio 4",
  hours: "Lunedì–venerdì · 10:00–12:00 e 13:30–15:00", note: "Solo su appuntamento. Orari da confermare con l'ufficio prima di andare.",
  transport: ["Metropolitana M3 Brenta o Corvetto", "Autobus 77, 84, 93, 95"],
  phone: "02 884 52909", tel: "+390288452909", email: "MTA.Uffdisabili@comune.milano.it", switchboard: "020202",
  gmaps: "https://www.google.com/maps/dir/?api=1&destination=Via%20Sile%208%2C%2020139%20Milano",
  osm: "https://www.openstreetmap.org/search?query=Via%20Sile%208%20Milano",
};

const requestWord = () => (S.request === "rinnovo" ? "rinnovo" : "primo rilascio");
const roleWord = () => ({ self: "me stesso", family: "un familiare", delegate: "un delegato", legal: "il tutore o amministratore di sostegno" })[S.role] || "[chi fa la domanda]";
const bringList = () => [...new Set(slots().map((s) => `${s.name}${s.hint ? ` (${s.hint})` : ""}`))];

function icsFile(date, time) {
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const start = new Date(`${date}T${time}`), end = new Date(start.getTime() + 30 * 60000);
  const desc = `Porta: ${bringList().join("; ")}. Porta anche gli originali, se li hai.`.replace(/[,;\\]/g, (m) => "\\" + m);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sportello Amico//IT", "BEGIN:VEVENT", `UID:${Date.now()}@sportello-amico`,
    `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    "SUMMARY:Appuntamento pass disabili", "LOCATION:Via Sile 8\\, Milano", `DESCRIPTION:${desc}`, "END:VEVENT", "END:VCALENDAR"];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = "appuntamento-pass-disabili.ics"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openOffice() {
  const script = `Buongiorno, vorrei un appuntamento per il pass disabili: ${requestWord()}, domanda fatta da ${roleWord()}. Quali giorni e orari ci sono? Cosa devo portare?`;
  const body = `Buongiorno,\n\nvorrei un appuntamento per il pass disabili (${requestWord()}).\nLa domanda è fatta da ${roleWord()}.\n\nNome e cognome: [nome e cognome]\nTelefono: [numero di telefono]\nGiorni e orari che preferisco: [giorni e orari]\n\nGrazie e cordiali saluti`;
  const mailto = `mailto:${OFFICE.email}?subject=${encodeURIComponent("Richiesta appuntamento pass disabili")}&body=${encodeURIComponent(body)}`;
  sheet("🏢 Vado di persona", `<h3>Dove</h3><p><strong>${esc(OFFICE.name)}</strong><br>${esc(OFFICE.address)} (${esc(OFFICE.area)})</p>
    <h3>Come arrivare</h3><p>${OFFICE.transport.map(esc).join("<br>")}</p>
    <p class="small">Il telefono usa la sua posizione: io non la vedo.</p>
    <div class="office-btns"><a class="chip" href="${OFFICE.gmaps}" target="_blank" rel="noopener">🗺️ Indicazioni con Google Maps</a>
    <a class="chip soft" href="${OFFICE.osm}" target="_blank" rel="noopener">🗺️ Indicazioni con OpenStreetMap</a></div>
    <h3>Orari</h3><p>${esc(OFFICE.hours)}<br><strong>${esc(OFFICE.note)}</strong></p>
    <h3>Contatti</h3><p>Telefono ${esc(OFFICE.phone)}<br>Email ${esc(OFFICE.email)}<br>Centralino ${esc(OFFICE.switchboard)}</p>
    <h3>Prenota</h3><p class="small">Non prenoto io e non mando nulla al Comune: scegli come fare.</p>
    <div class="office-btns"><a class="chip" href="tel:${OFFICE.tel}">📞 Chiama l'ufficio</a></div>
    <p class="office-script">${esc(script)}</p>
    <div class="office-btns"><a class="chip" href="${mailto}">✉️ Scrivi un'email</a></div>
    <p class="small">Si apre la tua posta con un testo da completare tu: non ci metto nessun dato personale.</p>
    <label for="of-date">Giorno dell'appuntamento</label><input id="of-date" type="date">
    <label for="of-time">Ora</label><input id="of-time" type="time">
    <div class="office-btns"><button class="chip" id="of-ics">📅 Aggiungi un promemoria</button></div>
    <p class="small" id="of-msg" role="status">Quando hai ottenuto l'appuntamento, scrivi giorno e ora: il file si crea qui, sul tuo dispositivo.</p>
    <h3>Cosa portare</h3><ul>${bringList().map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p><strong>Porta anche gli originali, se li hai.</strong> L'ufficio potrebbe chiederli.</p>`);
  $("of-ics").addEventListener("click", () => {
    if (!$("of-date").value || !$("of-time").value) return void ($("of-msg").textContent = "Scrivi prima il giorno e l'ora dell'appuntamento.");
    icsFile($("of-date").value, $("of-time").value);
    $("of-msg").textContent = "Fatto: apri il file scaricato per aggiungerlo al calendario.";
  });
}

function openDelegaSheet() {
  const fields = [["dg-name", "Persona con disabilità: nome e cognome"], ["dg-born", "nata/o a, il"], ["dg-doc", "documento n°, rilasciato da"],
    ["dl-name", "Tu (chi fa la domanda): nome e cognome"], ["dl-born", "nata/o a, il"], ["dl-doc", "documento n°, rilasciato da"], ["dg-place", "Luogo"]];
  sheet("📝 Preparo la delega", `<p>Questi dati <strong>restano qui</strong> e servono solo a compilare la delega da stampare.</p>
    ${fields.map(([id, l]) => `<label for="${id}">${l}</label><input id="${id}" autocomplete="off">`).join("")}
    <p style="margin-top:16px"><button class="chip" id="dg-print">🖨️ Stampa la delega</button></p>
    <p class="small">Dopo la firma, fotografala e mettila nella busta. Modulo ufficiale: <a href="${SRC.delega}" target="_blank" rel="noopener">mod-delega-3</a></p>`);
  $("dg-print").addEventListener("click", () => {
    const v = (id) => esc($(id).value);
    const plate = S.car === "yes" && S.plate;
    printWindow("Modulo delega", `<p class="small">Unità Gestione Permessi · Direzione Mobilità - Area Smart Mobility · Via Sile, 8 - 20139 Milano</p>
      <h1>MODULO DELEGA</h1>
      <p>Il/La sottoscritto/a <span class="line">${v("dg-name")}</span> nato/a a, il <span class="line">${v("dg-born")}</span> documento d'identità n°, rilasciato da <span class="line">${v("dg-doc")}</span></p>
      <h1>DELEGA</h1>
      <p>il/la Sig./ra <span class="line">${v("dl-name")}</span> nato/a a, il <span class="line">${v("dl-born")}</span> documento d'identità n°, rilasciato da <span class="line">${v("dl-doc")}</span></p>
      <p><strong>A RICHIEDERE PER MIO CONTO IL "CONTRASSEGNO DI PARCHEGGIO PER DISABILI"</strong></p>
      <p><strong>DICHIARA</strong> che i fatti, stati e qualità personali riportati nella presente domanda corrispondono a verità e che i documenti allegati alla presente domanda finalizzata all'ottenimento del pass per la sosta riservato alle persone disabili (CUDE — art. 381 DPR 495/1992) sono conformi agli originali ed in corso di validità e non hanno subito revoche, sospensioni o variazioni dalla data del loro rilascio.</p>
      <div class="box">${plate ? "☐" : "☒"} di non voler associare alcuna targa ai fini del libero transito in ZTL/Corsie riservate/Area C/Area B;<br>
      ${plate ? "☒" : "☐"} di voler associare la targa <span class="line">${plate ? esc(S.plate) : ""}</span> al Pass Disabili ai fini del libero transito in ZTL/Corsie riservate/Area C/Area B.<br>
      Solo se si associa una targa: ☐ di voler aderire / ☐ di non voler aderire alla Piattaforma unica contrassegno disabili – CUDE.</div>
      <p>Dichiaro di essere a conoscenza che il pass disabili, una volta ricevuto, andrà obbligatoriamente firmato con firma autografa, leggibile, da parte del titolare nello spazio "Firma del titolare". Qualora il titolare sia minorenne, nella casella andrà apposto un tratto continuo o tratteggiato di penna per tutta la lunghezza della casella.</p>
      <p>Dichiaro di conoscere ed accettare che il Pass Disabili è strettamente personale e la sua validità decade nei casi di: morte del beneficiario, perdita in capo all'intestatario di anche uno solo dei requisiti richiesti per il suo ottenimento, ad esclusione della residenza nel Comune di Milano, sostituzione, a qualsiasi titolo, di Pass Disabili in corso di validità con altro di nuova emissione. Nei casi sopra descritti, oltre che nel caso di naturale scadenza, lo stesso deve essere distrutto o riconsegnato per la distruzione ai competenti uffici.</p>
      <p>Dichiaro altresì di essere informato/a che i dati personali raccolti saranno trattati, anche con strumenti informatici, esclusivamente nell'ambito del procedimento per il quale la presente dichiarazione viene resa.</p>
      <p style="margin-top:40px">Il delegante<br><span class="line">${v("dg-place")}, ${new Date().toLocaleDateString("it-IT")}</span> (luogo e data) &nbsp; <span class="line">&nbsp;</span> (firma leggibile) ✍️ <strong>firma qui</strong></p>`);
  });
}

function printDoctorLetter() {
  printWindow("Lettera per il medico", `<p>Gentile Dottoressa, gentile Dottore,</p>
    <p>devo rinnovare il <strong>pass per la sosta e la circolazione delle persone con disabilità</strong> presso il Comune di Milano. Il pass mi era stato rilasciato per un'invalidità riconosciuta in modo permanente.</p>
    <p>Per il rinnovo il Comune chiede un certificato del medico curante che attesti <strong>con queste parole esatte</strong>:</p>
    <div class="box" style="font-size:19px"><strong>"${PHRASE_R6}"</strong></div>
    <p>Un certificato generico purtroppo non basta. La ringrazio molto per l'aiuto.</p>
    <p style="margin-top:30px">Nome del paziente: <span class="line">&nbsp;</span></p>
    <p class="small">Fonte: modulo "Richiesta pass per la sosta e la circolazione di persone con disabilità (CUDE)", Comune di Milano: ${esc(SRC.form)}</p>`);
}

function printWindow(title, html) {
  const w = window.open("", "_blank");
  if (!w) return bot("<p>Il browser ha bloccato la finestra di stampa. Consenti le finestre pop-up per questo sito e riprova.</p>");
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:Arial,sans-serif;font-size:15px;line-height:1.6;max-width:720px;margin:30px auto;padding:0 20px}h1{font-size:20px;text-align:center}
    .line{border-bottom:1px solid #000;display:inline-block;min-width:220px}.box{border:2px solid #000;padding:10px;margin:14px 0}.small{font-size:12px;color:#444}</style></head>
    <body>${html}<p class="small">Preparato con lo Sportello Amico (prototipo). Confronta sempre con il modulo ufficiale del Comune.</p></body></html>`);
  w.document.close();
  w.focus(); w.print(); // no inline script: keeps the Content-Security-Policy strict
}

function officeSheetData() {
  const m = S.medical, r = S.rehearsal && !S.rehearsal.scanning ? S.rehearsal : null;
  const rows = [];
  if (m) m.controlli.forEach((c) => rows.push({ regola: c.regola, controllo: "documento sanitario", esito: c.esito, fonte: m.fonti?.[c.regola] || SRC.form }));
  slots().filter((s) => s.id !== "medical").forEach((s) => rows.push({ regola: ["reqFront", "reqBack", "delega", "nomina"].includes(s.id) ? "R3" : "R2",
    controllo: `${s.name} (${s.hint})`, esito: (S.files[s.id]?.status === "ok" ? "presente" : S.files[s.id]?.status === "warn" ? "da verificare" : S.files[s.id]?.status === "bad" ? "da sistemare" : "manca")
      + (S.files[s.id]?.check ? ", controllato" : ""), fonte: SRC.form }));
  if (r) rows.push({ regola: "Prova generale", controllo: "riepilogo del modulo", esito: r.pronto_per_inoltro ? "nessun problema" : `${r.problemi.length} problemi segnalati`, fonte: null });
  return { avviso: "Controllo automatico di completezza, non è una decisione sul rilascio.", data: new Date().toLocaleDateString("it-IT"),
    ruolo: S.role ? ROLES[S.role].official : "—", richiesta: S.request === "rinnovo" ? `rinnovo${S.permanent ? " (permanente)" : ""}` : "primo rilascio",
    consegna_consigliata: S.canGoOut === "no" ? "raccomandata" : "a scelta", controlli: rows,
    dubbi: m ? m.controlli.filter((c) => c.esito === "non_sicuro").map((c) => c.regola) : [] };
}

function openOfficeSheet() {
  const d = officeSheetData();
  sheet("📋 Scheda per l'ufficio", `<p>Per l'operatore del Comune: cosa è già stato controllato e con quali regole. <strong>Nessun dato personale o sanitario.</strong></p>
    <p class="disclaimer">${esc(d.avviso)}</p>
    <table class="office"><tr><th>Controllo</th><th>Esito</th><th>Regola</th></tr>
      ${d.controlli.map((c) => `<tr><td>${esc(c.controllo)}</td><td>${esc(c.esito)}</td><td>${c.fonte ? `<a href="${esc(c.fonte)}" target="_blank" rel="noopener">${esc(c.regola)}</a>` : esc(c.regola)}</td></tr>`).join("")}</table>
    <p class="small">Ruolo: ${esc(d.ruolo)} · Richiesta: ${esc(d.richiesta)} · Consegna consigliata: ${esc(d.consegna_consigliata)} · ${esc(d.data)}</p>
    <p><button class="chip" id="dl-json">⬇️ Scarica in formato dati (JSON)</button> <button class="chip soft" id="office-print">🖨️ Stampa</button></p>`);
  $("office-print").addEventListener("click", () => window.print());
  $("dl-json").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
    a.download = "scheda_controlli_pass.json"; a.click();
  });
}

// ===================================================================================== header tools

function toggleVoice(force) {
  voiceOn = force ?? !voiceOn;
  $("btn-voice").setAttribute("aria-pressed", voiceOn);
  if (!voiceOn) window.speechSynthesis?.cancel();
}

function resetSession(keepUser) {
  Object.values(S.files).forEach((f) => f?.url && URL.revokeObjectURL(f.url));
  const { mock, user } = S;
  S = fresh(); S.mock = mock; if (keepUser) S.user = user;
  window.speechSynthesis?.cancel();
  Connectors.chat.reset();
  $("chat").innerHTML = ""; chips([]);
}

function logout() {
  if (!confirm("Uscendo cancelliamo tutti i documenti e le risposte. Vuoi uscire?")) return;
  resetSession(false);
  location.hash = "home";
}

// ===================================================================================== pages: home, simulated login, counter

function route() {
  let view = location.hash.slice(1) || "home";
  if (view === "info") view = "home";
  if (view === "sportello" && !S.user) { location.hash = "accesso"; return; }
  const views = { home: "view-home", accesso: "view-login", sportello: "view-sportello" };
  if (!views[view]) view = "home";
  Object.entries(views).forEach(([k, id]) => { $(id).hidden = k !== view; });
  const titles = { home: "Pass disabili, preparato insieme", accesso: "Accesso", sportello: "Allo sportello" };
  document.title = `${titles[view]} · Sportello Amico`;
  const inside = view === "sportello";
  $("btn-wipe").hidden = !inside; $("btn-logout").hidden = !S.user;
  $("who").hidden = !S.user;
  if (S.user) { $("who").textContent = `${USERS[S.user].face} ${USERS[S.user].name} · accesso simulato`; hideEmoji($("who")); }
  if (inside && !$("chat").children.length) welcome();
  let anchor = view === "home" && location.hash.length > 1 ? document.getElementById(location.hash.slice(1)) : null;
  if (anchor && !$("view-home").contains(anchor)) anchor = null;
  if (anchor) anchor.scrollIntoView();
  else window.scrollTo(0, 0);
  // move focus to the new view so screen readers announce the page change (the counter focuses its first chip itself)
  if (!inside) (anchor || $(views[view])).focus({ preventScroll: true });
}

function wipe() {
  if (!confirm("Vuoi cancellare tutti i documenti e le risposte?")) return;
  resetSession(true);
  addMsg("bot", "<p>🗑️ <strong>Ho cancellato tutto.</strong> Su questo dispositivo non resta nessun documento.</p>");
  setTimeout(welcome, 900);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("btn-voice").addEventListener("click", () => toggleVoice());
  $("btn-wipe").addEventListener("click", wipe);
  $("btn-size").addEventListener("click", (e) => e.currentTarget.setAttribute("aria-pressed", document.documentElement.classList.toggle("large")));
  $("btn-contrast").addEventListener("click", (e) => e.currentTarget.setAttribute("aria-pressed", document.documentElement.classList.toggle("contrast")));
  $("sheet-close").addEventListener("click", () => $("sheet").close());
  $("btn-logout").addEventListener("click", logout);
  document.querySelectorAll(".persona").forEach((b) => b.addEventListener("click", () => { S.user = b.dataset.user; location.hash = "sportello"; }));
  window.addEventListener("hashchange", route);
  setupMic();
  setupAsk();
  try {
    const st = await Connectors.backend.status();
    S.mock = st.mock; $("mock-banner").hidden = !st.mock;
  } catch { /* server offline: local steps still work */ }
  route();
});
