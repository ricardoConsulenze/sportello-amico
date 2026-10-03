/* Runtime configuration. In production this file is regenerated at container start from environment
 * variables (deploy/frontend/40-app-config.sh), so the same image runs in staging and production.
 * Never put secrets here: everything in this file is public. */
window.APP_CONFIG = {
  env: "development",
  // empty = same origin (server.py locally, nginx reverse proxy in production)
  apiBaseUrl: "",
  requestTimeoutMs: 180000,
  // free-text chat: "backend" = /api/ask of server.py, "langgraph" = Agent Server below, "off" = hidden
  chat: { provider: "backend" },
  langgraph: {
    enabled: false,
    baseUrl: "/langgraph", // proxied by nginx, which adds the API key server-side
    assistantId: "sportello",
  },
};
