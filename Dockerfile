# ==============================================================================
# Collaborative Markdown Editor (CME) - Multi-Stage Production Dockerfile
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Frontend Build
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Backend Compilation
# ------------------------------------------------------------------------------
FROM ubuntu:24.04 AS backend-builder
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    pkg-config \
    libpq-dev \
    libssl-dev \
    libcrypt-dev \
    zlib1g-dev \
    ca-certificates \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY CMakeLists.txt ./
COPY cmake/ ./cmake/
COPY backend/ ./backend/

RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TESTING=OFF

RUN cmake --build build --target cme-server cme-migrate cme-admin -j$(nproc)

# ------------------------------------------------------------------------------
# Stage 3: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM ubuntu:24.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libpq5 \
    libssl3 \
    libcrypt1 \
    curl \
    bash \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install compiled application binaries and dependencies
COPY --from=backend-builder /app/build/bin/cme-server /usr/local/bin/cme-server
COPY --from=backend-builder /app/build/bin/cme-migrate /usr/local/bin/cme-migrate
COPY --from=backend-builder /app/build/bin/cme-admin /usr/local/bin/cme-admin
COPY --from=backend-builder /app/build/lib/libyrs.so /usr/local/lib/libyrs.so
RUN ldconfig

# Install embedded UI static assets
COPY --from=frontend-builder /app/frontend/dist /var/lib/cme/frontend/dist

# Install database migrations and scripts
COPY migrations /var/lib/cme/migrations
COPY scripts/cme-backup.sh /usr/local/bin/cme-backup.sh
RUN chmod +x /usr/local/bin/cme-backup.sh

# Install entrypoint script and default config
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY config.yaml /etc/cme/config.yaml

# Create storage hierarchy
RUN mkdir -p /var/lib/cme/storage /var/lib/cme/storage/backups /etc/cme

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["cme-server"]
