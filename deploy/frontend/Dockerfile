# Frontend: static files served by nginx, which also proxies /api and /langgraph.
# Build from the repo root:  docker build -f deploy/frontend/Dockerfile -t sportello-frontend .
FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root
COPY static/ /usr/share/nginx/html/
COPY deploy/frontend/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/frontend/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
RUN chmod +x /docker-entrypoint.d/40-app-config.sh \
 && mkdir -p /etc/nginx/snippets \
 && chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/snippets /etc/nginx/conf.d
USER nginx

# defaults; override at runtime (docker run -e / compose / platform env)
ENV APP_ENV=production \
    BACKEND_URL=http://backend:8765 \
    LANGGRAPH_URL= \
    LANGGRAPH_API_KEY= \
    LANGGRAPH_ASSISTANT_ID=sportello \
    API_BASE_URL= \
    CSP_CONNECT_EXTRA=

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
