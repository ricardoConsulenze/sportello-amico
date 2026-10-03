/* Connectors: the only place where the frontend talks to the outside world.
 *
 *   Connectors.backend  -> Python backend (document checks with Claude, demo files, status)
 *   Connectors.chat     -> free-text chatbot: the backend's /api/ask (default) or a LangGraph Agent Server
 *
 * Both are configured by window.APP_CONFIG (config.js). Privacy: the conversation lives only in memory
 * (here for /api/ask, in a thread for LangGraph) and is forgotten when the person presses "Cancella tutto"
 * or logs out.
 */
"use strict";

(function () {
  const CFG = window.APP_CONFIG || {};
  const LG = Object.assign({ enabled: false, baseUrl: "/langgraph", assistantId: "sportello" }, CFG.langgraph);
  // "langgraph" when an Agent Server is configured, otherwise the backend's /api/ask; "off" hides the chat
  const CHAT = CFG.chat?.provider || (LG.enabled ? "langgraph" : "backend");
  const API = (CFG.apiBaseUrl || "").replace(/\/$/, "");
  const TIMEOUT = CFG.requestTimeoutMs || 180000;

  class ConnectorError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  // fetch with a timeout; maps network failures to plain Italian messages
  async function request(url, opts = {}, timeout = TIMEOUT) {
    const ctrl = new AbortController();
    let timedOut = false;
    // abort() without a reason, so fetch and stream reads reject with a standard AbortError
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    opts.signal?.addEventListener("abort", () => ctrl.abort());
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      if (timedOut) throw new ConnectorError("Il controllo sta impiegando troppo tempo. Riprova.", 0);
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      throw new ConnectorError("Connessione assente. Controlla internet e riprova.", 0);
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = res.status === 413 ? "File troppo grandi." : "Qualcosa non ha funzionato. Riprova.";
      throw new ConnectorError(data.errore || fallback, res.status);
    }
    return data;
  }

  // ================================================================================ Python backend

  const backend = {
    async status() {
      return json(await request(`${API}/api/status`, {}, 10000));
    },
    async post(path, body) {
      return json(await request(`${API}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
    },
    checkMedical(payload) { return backend.post("/api/check-medical", payload); },
    checkSummary(payload) { return backend.post("/api/check-summary", payload); },
    // only for documents the person agreed to have checked (PRIVACY.md)
    checkDocument(payload) { return backend.post("/api/check-document", payload); },
    async demoFile(name) {
      const res = await request(`${API}/demo/${encodeURIComponent(name)}`);
      if (!res.ok) throw new ConnectorError("File di esempio non trovato.", res.status);
      return res.blob();
    },
  };

  // ================================================================================ LangGraph chatbot

  let threadId = null;
  let running = null; // AbortController of the run being streamed

  const lgUrl = (path) => `${LG.baseUrl.replace(/\/$/, "")}${path}`;
  const lgHeaders = { "Content-Type": "application/json" };

  async function ensureThread() {
    if (threadId) return threadId;
    const res = await request(lgUrl("/threads"), { method: "POST", headers: lgHeaders, body: JSON.stringify({ metadata: { app: "sportello-amico" } }) }, 15000);
    threadId = (await json(res)).thread_id;
    return threadId;
  }

  // Server-Sent Events over a POST body (EventSource only supports GET)
  async function* sse(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, cut); buf = buf.slice(cut + 2);
        let event = "message", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) yield { event, data: JSON.parse(data) };
      }
    }
  }

  const textOf = (content) => (typeof content === "string" ? content
    : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text).join("") : "");

  // /api/ask is stateless: the browser keeps the plain-text turns and sends them with each question
  const MAX_TURNS = 20; // same limit as server.py
  let history = [];

  async function* askBackend(text, context, signal) {
    const res = await request(`${API}/api/ask`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ domanda: text, cronologia: history, situazione: context }),
    });
    const data = await json(res);
    history = history.concat({ ruolo: "user", testo: text }, { ruolo: "assistant", testo: data.risposta || "" })
      .slice(-MAX_TURNS);
    if (data.risposta) yield data.risposta;
    // sources and offices come last, as one object: askChat() shows them under the answer
    if (data.fonti?.length || data.sedi?.length) yield { fonti: data.fonti || [], sedi: data.sedi || [] };
  }

  async function* askLangGraph(text, context, signal) {
    const id = await ensureThread();
    const res = await request(lgUrl(`/threads/${id}/runs/stream`), {
      method: "POST", headers: lgHeaders, signal,
      body: JSON.stringify({
        assistant_id: LG.assistantId,
        input: { messages: [{ role: "user", content: text }] },
        config: { configurable: { sportello: context } },
        stream_mode: ["messages-tuple"],
        multitask_strategy: "interrupt",
      }),
    });
    if (!res.ok) await json(res);
    for await (const { event, data } of sse(res)) {
      if (event === "error") throw new ConnectorError("Lo sportello non riesce a rispondere ora. Riprova.", 502);
      // messages-tuple: data = [messageChunk, metadata]; only the assistant's tokens are shown
      if (event === "messages" && Array.isArray(data)) {
        const [msg] = data;
        if (msg && (msg.type === "AIMessageChunk" || msg.type === "ai")) {
          const delta = textOf(msg.content);
          if (delta) yield delta;
        }
      }
    }
  }

  const chat = {
    get enabled() { return CHAT === "backend" || (CHAT === "langgraph" && !!LG.enabled); },
    provider: CHAT,

    /* Yields the reply as text pieces (streamed with LangGraph, one piece with /api/ask), then possibly
     * one object {fonti, sedi} with the sources and the offices found. `context` is the non-personal
     * state of the counter (stage, role, request type). */
    async *ask(text, context = {}) {
      if (!chat.enabled) throw new ConnectorError("La chat non è attiva.", 0);
      chat.cancel();
      const mine = running = new AbortController();
      try {
        yield* (CHAT === "langgraph" ? askLangGraph : askBackend)(text, context, mine.signal);
      } finally {
        if (running === mine) running = null; // a newer question may already own it
      }
    },

    cancel() { running?.abort(); running = null; },

    // "Cancella tutto": forget the conversation here and on the server (best effort)
    async reset() {
      chat.cancel();
      history = [];
      const id = threadId; threadId = null;
      if (id && CHAT === "langgraph") {
        try { await request(lgUrl(`/threads/${id}`), { method: "DELETE", headers: lgHeaders }, 10000); } catch { /* offline: the Agent Server must expire threads (TTL), see docs/INTEGRAZIONE-FE-BE.md */ }
      }
    },
  };

  window.Connectors = { config: CFG, backend, chat, ConnectorError };
})();
