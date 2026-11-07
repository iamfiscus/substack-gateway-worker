# Differential parity harness image: upstream substack-gateway-oss (bc2e875) on
# Python 3.12 via uv, this Worker under wrangler dev on Node 22, and the fake
# Substack. Build from the repository root:
#
#   docker build -f harness/Dockerfile -t substack-gateway-harness .
#   docker run --rm substack-gateway-harness
#
# The same image backs the Sandbox container of harness/wrangler.jsonc.
# linux/amd64: what Cloudflare Containers run (and the arm64 cryptography wheel
# upstream pulls in dies with SIGILL under Docker Desktop on Apple silicon).
FROM --platform=linux/amd64 ghcr.io/astral-sh/uv:0.7.2 AS uv

FROM --platform=linux/amd64 node:22.20.0-bookworm-slim

COPY --from=uv /uv /uvx /usr/local/bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV UV_PYTHON=3.12 \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_LINK_MODE=copy \
    WRANGLER_SEND_METRICS=false \
    CI=1

WORKDIR /app

# This repo's dependencies first, for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Upstream at the pinned commit, with its locked environment on Python 3.12.
COPY scripts/fetch-upstream.sh scripts/fetch-upstream.sh
RUN scripts/fetch-upstream.sh \
    && uv python install 3.12 \
    && cd upstream && uv sync --frozen

COPY . .

CMD ["harness/start.sh"]
