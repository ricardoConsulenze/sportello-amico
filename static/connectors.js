/* Connectors: the only place where the frontend talks to the outside world.
 *
 *   Connectors.backend  -> Python backend (document checks with Claude, demo files, status)
 *   Connectors.chat     -> LangGraph Agent Server (free-text chatbot, streamed)
 *
 * Both are configured by window.APP_CONFIG (config.js). Privacy: the chat thread lives only in memory
 * and is deleted on the server when the person presses "Cancella tutto" or logs out.
 */
"use strict";

(function () {
  const CFG = window.APP_CONFIG || {};
  const LG = Object.assign({ enabled: false, baseUrl: "/langgraph", assistantId: "sportello" }, CFG.langgraph);
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

  const chat = {
    get enabled() { return !!LG.enabled; },

    /* Streams the assistant reply. `context` is the non-personal state of the counter (stage, role,
     * request type): it reaches the graph as config.configurable.sportello. Yields text deltas. */
    async *ask(text, context = {}) {
      if (!LG.enabled) throw new ConnectorError("La chat non è attiva.", 0);
      chat.cancel();
      const mine = running = new AbortController();
      const id = await ensureThread();
      const res = await request(lgUrl(`/threads/${id}/runs/stream`), {
        method: "POST", headers: lgHeaders, signal: mine.signal,
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
      if (running === mine) running = null; // a newer question may already own it
    },

    cancel() { running?.abort(); running = null; },

    // "Cancella tutto": forget the conversation here and on the server (best effort)
    async reset() {
      chat.cancel();
      const id = threadId; threadId = null;
      if (id && LG.enabled) {
        try { await request(lgUrl(`/threads/${id}`), { method: "DELETE", headers: lgHeaders }, 10000); } catch { /* offline: the Agent Server must expire threads (TTL), see docs/INTEGRAZIONE-FE-BE.md */ }
      }
    },
  };

  window.Connectors = { config: CFG, backend, chat, ConnectorError };
})();
