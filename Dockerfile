FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
ARG OPENCLAW_AWAL="false"
RUN apt-get update && \
    if [ "$OPENCLAW_AWAL" = "true" ]; then \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libasound2 libatk-bridge2.0-0 libcairo2 libgbm1 libgtk-3-0 libnss3 \
        libpango-1.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
        xauth xvfb; \
    fi && \
    if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES; \
    fi && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Pre-install awal server bundle (opt-in via --build-arg OPENCLAW_AWAL=true)
# Pin explicit version to avoid stale npx cache from Docker layer caching.
ARG AWAL_VERSION=2.0.3
ENV AWAL_DIR=/home/node/.local/share/awal/server
ENV AWAL_HOME=/home/node
RUN if [ "$OPENCLAW_AWAL" = "true" ]; then \
      npx "awal@${AWAL_VERSION}" --version > /dev/null 2>&1 || true \
      && NPX_CACHE=$(find /home/node/.npm/_npx -path '*/awal/server-bundle' -type d 2>/dev/null | head -1) \
      && if [ -z "${NPX_CACHE}" ]; then echo "ERROR: could not locate awal server-bundle" >&2; exit 1; fi \
      && mkdir -p "${AWAL_DIR}" \
      && cp -r "${NPX_CACHE}/"* "${AWAL_DIR}/" \
      && cd "${AWAL_DIR}" && npm install --omit=dev \
      && echo "${AWAL_VERSION}" > "${AWAL_DIR}/.version" \
      && echo "awal ${AWAL_VERSION} pre-installed"; \
    fi

# Pre-install SAW binaries (opt-in via --build-arg OPENCLAW_AWAL=true)
ARG SAW_VERSION=0.1.5
ENV SAW_ROOT=/home/node/.saw
RUN if [ "$OPENCLAW_AWAL" = "true" ]; then \
      ARCH="$(uname -m)" \
      && case "$ARCH" in x86_64|amd64) ARCH="x86_64" ;; arm64|aarch64) ARCH="arm64" ;; esac \
      && ARCHIVE="saw-linux-${ARCH}.tar.gz" \
      && URL="https://github.com/daydreamsai/agent-wallet/releases/download/v${SAW_VERSION}/${ARCHIVE}" \
      && mkdir -p "${SAW_ROOT}/bin" \
      && curl -sSL -o /tmp/saw.tar.gz "$URL" \
      && tar xzf /tmp/saw.tar.gz -C "${SAW_ROOT}/bin" \
      && chmod 755 "${SAW_ROOT}/bin/saw" "${SAW_ROOT}/bin/saw-daemon" \
      && rm -f /tmp/saw.tar.gz \
      && echo "SAW v${SAW_VERSION} installed to ${SAW_ROOT}/bin"; \
    fi

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
#
# With OPENCLAW_AWAL=true, use the awal entrypoint which starts the Electron
# daemon before launching the gateway:
#   CMD ["bash", "scripts/gateway-awal-entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
