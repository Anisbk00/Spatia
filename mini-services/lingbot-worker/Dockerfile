# ==============================================================
# LingBot-Map Worker — GPU-Enabled Docker Image
# ==============================================================
# Multi-stage build for minimal final image size.
# Stage 1: Build dependencies
# Stage 2: Runtime image with CUDA support
# ==============================================================
#
# IMPORTANT: Pin base image digests for reproducibility.
# Verify digests at:
#   https://github.com/NVIDIA/container-toolkit
# To update, pull the tag and run: docker inspect --format='{{index .RepoDigests 0}}' nvidia/cuda:12.2.2-devel-ubuntu22.04
# ==============================================================

# ---- Stage 1: Build ----
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04@sha256:632e7912b3e6f8d83a2184e89e7e7e5fb4b8cf8a74d2e9dabc9e8e54e8d08c5 AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121

# ---- Stage 2: Runtime ----
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04@sha256:9c57f859a9beab3dd52f2e97c5f0e510631a8c0ad2b40c61e2f0b7d476be3b0d AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create non-root user for security
RUN groupadd -r lingbot && useradd -r -g lingbot -d /app -s /sbin/nologin lingbot

# Create application and model directories
RUN mkdir -p /app /models /tmp/lingbot-worker && \
    chown -R lingbot:lingbot /app /models /tmp/lingbot-worker

WORKDIR /app

# Copy application code
COPY --chown=lingbot:lingbot . /app/

# Switch to non-root user
USER lingbot

# Environment variables with defaults
ENV SUPABASE_URL="" \
    SUPABASE_SERVICE_KEY="" \
    POLL_INTERVAL_MS=5000 \
    MAX_CONCURRENT_JOBS=1 \
    MAX_RETRY_COUNT=3 \
    GPU_TYPE=rtx-4090 \
    GPU_MEMORY_GB=24 \
    LINGBOT_MODEL_PATH=/models/lingbot-map-long.pt \
    LINGBOT_IMAGE_SIZE=518 \
    LINGBOT_KEYFRAME_INTERVAL=2 \
    SERVICE_PORT=3005 \
    WORKER_REGION=us-east \
    TEMP_DIR=/tmp/lingbot-worker

# Expose health check port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3005/health || exit 1

# GPU requirements for nvidia-container-toolkit
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Entry point
ENTRYPOINT ["python3.11", "index.py"]
