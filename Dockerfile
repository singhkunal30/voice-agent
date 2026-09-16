# ---- Stage 1: build the Architecture Simulator UI -------------------------
# Produces simulator/dist, which the FastAPI app serves at /lab. Kept in its
# own stage so none of the Node toolchain reaches the runtime image.
FROM node:22-alpine AS ui
WORKDIR /ui
COPY simulator/package.json simulator/package-lock.json ./
RUN npm ci
COPY simulator/ ./
RUN npm run build:only

# ---- Stage 2: the voice agent runtime -------------------------------------
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

# The built simulator. Its absence would only disable /lab, but building it
# here means `docker run` serves the learning lab out of the box.
COPY --from=ui /ui/dist ./simulator/dist

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
