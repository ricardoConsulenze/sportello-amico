# Backend: server.py (Claude document checks). Build from the repo root:
#   docker build -f deploy/backend/Dockerfile -t sportello-backend .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8765
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py rules.py ./
COPY static/ static/
COPY demo_docs/ demo_docs/
RUN useradd --system --uid 10001 app
USER app

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/status', timeout=2)"
CMD ["python", "server.py"]
