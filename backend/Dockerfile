# Multi-stage build pour un conteneur minimaliste et sécurisé
FROM python:3.11-slim-bookworm AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /install

# Dépendances système pour compiler bitnet.cpp / onnxruntime-genai et ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# --- Image Finale de Production ---
FROM python:3.11-slim-bookworm AS runner

ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 \
    BITNET_CPU_THREADS=4 \
    MODEL_DIR=/app/models

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copie des packages python précompilés
COPY --from=builder /install /usr/local

# Création d'un utilisateur non-root pour la sécurité
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/models /app/logs && \
    chown -R appuser:appuser /app

USER appuser

COPY --chown=appuser:appuser ./app /app/app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
