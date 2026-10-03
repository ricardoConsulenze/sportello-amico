#!/bin/sh
# Runs at container start (nginx entrypoint), after the templates are rendered.
#  1. writes the public runtime config read by the browser (static/config.js);
#  2. writes the LangGraph proxy rules, or nothing if LANGGRAPH_URL is empty (chat disabled).
set -eu

HTML=/usr/share/nginx/html
SNIPPET=/etc/nginx/snippets/langgraph.conf
json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

if [ -n "${LANGGRAPH_URL:-}" ]; then CHAT=true; else CHAT=false; fi

cat > "$HTML/config.js" <<JS
/* generated at container start by 40-app-config.sh: do not edit */
window.APP_CONFIG = {
  env: $(json_str "${APP_ENV:-production}"),
  apiBaseUrl: $(json_str "${API_BASE_URL:-}"),
  requestTimeoutMs: 180000,
  langgraph: { enabled: $CHAT, baseUrl: "/langgraph", assistantId: $(json_str "${LANGGRAPH_ASSISTANT_ID:-sportello}") },
};
JS

if [ "$CHAT" = false ]; then
  echo "location /langgraph/ { return 404; }" > "$SNIPPET"
  echo "40-app-config: chat disabled (LANGGRAPH_URL empty)"
  exit 0
fi

UPSTREAM="${LANGGRAPH_URL%/}"
KEY_HEADER=""
[ -n "${LANGGRAPH_API_KEY:-}" ] && KEY_HEADER="proxy_set_header x-api-key \"${LANGGRAPH_API_KEY}\";"

# Only the three calls the frontend makes are exposed. Everything else on the Agent Server
# (thread search, assistants, store, crons) stays private: it would leak other people's chats.
cat > "$SNIPPET" <<NGINX
location = /langgraph/threads {
  limit_except POST { deny all; }
  limit_req zone=chat burst=5 nodelay;
  rewrite ^/langgraph(/.*)\$ \$1 break;
  include /etc/nginx/snippets/langgraph-proxy.conf;
}
location ~ ^/langgraph/threads/[0-9a-fA-F-]{36}/runs/stream\$ {
  limit_except POST { deny all; }
  limit_req zone=chat burst=5 nodelay;
  rewrite ^/langgraph(/.*)\$ \$1 break;
  include /etc/nginx/snippets/langgraph-proxy.conf;
}
location ~ ^/langgraph/threads/[0-9a-fA-F-]{36}\$ {
  limit_except DELETE { deny all; }
  rewrite ^/langgraph(/.*)\$ \$1 break;
  include /etc/nginx/snippets/langgraph-proxy.conf;
}
location /langgraph/ { return 404; }
NGINX

cat > /etc/nginx/snippets/langgraph-proxy.conf <<NGINX
proxy_pass $UPSTREAM;
proxy_ssl_server_name on;
proxy_http_version 1.1;
proxy_set_header Connection "";
$KEY_HEADER
proxy_buffering off;            # stream tokens as they arrive (SSE)
proxy_cache off;
proxy_read_timeout 300s;
client_max_body_size 64k;
NGINX
echo "40-app-config: chat enabled -> $UPSTREAM (assistant ${LANGGRAPH_ASSISTANT_ID:-sportello})"
