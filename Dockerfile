FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl \
        ffmpeg \
        libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY prompts ./prompts
COPY scripts ./scripts
COPY pyproject.toml .

# Run as a non-root user.
RUN useradd --create-home --uid 10001 voiceagent \
 && chown -R voiceagent:voiceagent /app
USER voiceagent

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

# `--proxy-headers` so X-Forwarded-* from the load balancer is honored.
# Uvicorn handles SIGTERM gracefully — drains in-flight requests before exit.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
