# syntax=docker/dockerfile:1.7
#
# Orbit Web 0.8.0: one image with the official Claude Code CLI, GitHub CLI, the Azure CLI, git, the Orbit plugin (at a pinned commit
# of this repository), and Orbit Web's NestJS API serving its React app. Built from the REPOSITORY ROOT:
#
#   docker build -f integrations/orbit-web/docker/Dockerfile -t orbit-web:0.8.0 .
#
# Behind a TLS-inspecting proxy, hand its CA to the build steps that download (never kept in a layer):
#
#   docker build --secret id=ca,src=/path/to/ca.pem -f integrations/orbit-web/docker/Dockerfile -t orbit-web:0.8.0 .
#
# Every input is pinned: the base image by digest, npm packages by package-lock.json and exact versions, the GitHub
# CLI, tini and CPython release files by SHA-256 per architecture, the Azure CLI by the plugin's own hash-checked lock,
# the plugin by the commit ORBIT_REF names. No credential is
# needed or kept: a person signs in after the container starts.

ARG NODE_IMAGE=node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496

# --- the web app and the API, built ---------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY integrations/orbit-web/package.json integrations/orbit-web/package-lock.json ./
COPY integrations/orbit-web/packages/contracts/package.json packages/contracts/
COPY integrations/orbit-web/apps/api/package.json apps/api/
COPY integrations/orbit-web/apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund
COPY integrations/orbit-web/ ./
RUN npm run build -w @orbit-web/contracts && npm run build -w @orbit-web/api && npm run build -w @orbit-web/web

# --- only what the API needs at run time ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime-deps
WORKDIR /opt/orbit-web
COPY integrations/orbit-web/package.json integrations/orbit-web/package-lock.json ./
COPY integrations/orbit-web/packages/contracts/package.json packages/contracts/
COPY integrations/orbit-web/apps/api/package.json apps/api/
COPY integrations/orbit-web/apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --omit=dev --no-audit --no-fund -w @orbit-web/api \
 && rm -rf /root/.npm

# --- the Orbit plugin, as `git archive` makes it (export-ignore applies: no evaluator, no integrations) ------------------
FROM ${NODE_IMAGE} AS plugin
ARG ORBIT_REF=HEAD
COPY .git /repo/.git
RUN mkdir -p /opt/orbit/plugin \
 && git -C /repo archive --format=tar "${ORBIT_REF}" | tar -x -C /opt/orbit/plugin \
 && git -C /repo rev-parse "${ORBIT_REF}^{commit}" > /opt/orbit/commit \
 && node -e 'const p=require("/opt/orbit/plugin/.claude-plugin/plugin.json"); if (p.name !== "orbit") throw new Error("not the Orbit plugin"); console.log("orbit", p.version)'

# --- the official CLIs, pinned ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS tools
ARG TARGETARCH
ARG CLAUDE_CODE_VERSION=2.1.328
ARG GH_VERSION=2.89.0
ARG GH_SHA256_AMD64=d0422caade520530e76c1c558da47daebaa8e1203d6b7ff10ad7d6faba3490d8
ARG GH_SHA256_ARM64=9e64a623dfc242990aa5d9b3f507111149c4282f66b68eaad1dc79eeb13b9ce5
ARG TINI_VERSION=0.19.0
ARG TINI_SHA256_AMD64=c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee
ARG TINI_SHA256_ARM64=eae1d3aa50c48fb23b8cbdf4e369d0910dfc538566bfd09df89a774aa84a48b9
RUN --mount=type=secret,id=ca,required=false \
    set -eu; \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca CURL_CA_BUNDLE=/run/secrets/ca; fi; \
    case "${TARGETARCH}" in \
      amd64) GH_SHA="${GH_SHA256_AMD64}"; TINI_SHA="${TINI_SHA256_AMD64}" ;; \
      arm64) GH_SHA="${GH_SHA256_ARM64}"; TINI_SHA="${TINI_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    echo "${GH_SHA}  /tmp/gh.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/gh/bin; \
    tar -xzf /tmp/gh.tar.gz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /opt/gh/bin/gh; \
    curl -fsSL -o /tmp/tini "https://github.com/krallin/tini/releases/download/v${TINI_VERSION}/tini-static-${TARGETARCH}"; \
    echo "${TINI_SHA}  /tmp/tini" | sha256sum -c -; \
    install -m 0755 /tmp/tini /opt/tini; \
    npm install --global --prefix /opt/claude --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    /opt/claude/bin/claude --version; \
    /opt/gh/bin/gh --version; \
    rm -rf /tmp/gh* /tmp/tini /root/.npm

# --- the Azure CLI, exactly as Orbit's own catalog pins it (catalog/tools.json, azure-cli-private): CPython 3.13.15 from
# python-build-standalone by SHA-256, then pip over the plugin's own lock -- every distribution and hash named, wheels
# only, no dependency resolution. AZURE_CLI=0 builds an image without it (the Azure card then says so). -------------------
FROM ${NODE_IMAGE} AS azure
ARG TARGETARCH
ARG AZURE_CLI=1
ARG PYTHON_RELEASE=20260924
ARG PYTHON_VERSION=3.13.15
ARG PYTHON_SHA256_AMD64=c20e1ff8600a0241849588b36948942eaccdc80da34df69674f3784a687197de
ARG PYTHON_SHA256_ARM64=c8dd48f5e5be632b518a79076189419cb8591559959ec137e4d30f5ce143c04d
ARG AZURE_CLI_VERSION=2.91.0
COPY --from=plugin /opt/orbit/plugin/catalog/locks /locks
RUN --mount=type=secret,id=ca,required=false \
    set -eu; \
    mkdir -p /opt/azure-cli/bin; \
    if [ "${AZURE_CLI}" != "1" ]; then echo "built without the Azure CLI"; exit 0; fi; \
    CERT=""; \
    if [ -s /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca; CERT="--cert /run/secrets/ca"; fi; \
    case "${TARGETARCH}" in \
      amd64) PY_ARCH=x86_64; PY_SHA="${PYTHON_SHA256_AMD64}"; LOCK="linux-x64" ;; \
      arm64) PY_ARCH=aarch64; PY_SHA="${PYTHON_SHA256_ARM64}"; LOCK="linux-arm64" ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/python.tar.gz "https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}%2B${PYTHON_RELEASE}-${PY_ARCH}-unknown-linux-gnu-install_only.tar.gz"; \
    echo "${PY_SHA}  /tmp/python.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/python.tar.gz -C /opt/azure-cli; \
    /opt/azure-cli/python/bin/python3 -m venv /opt/azure-cli/venv; \
    /opt/azure-cli/venv/bin/python -m pip install --isolated --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: --no-deps ${CERT} -r "/locks/azure-cli-${AZURE_CLI_VERSION}-${LOCK}.lock"; \
    printf '#!/bin/sh\n# The Azure CLI, run isolated from any Python setting of the environment, writing no bytecode.\nexec /opt/azure-cli/venv/bin/python -IBm azure.cli "$@"\n' > /opt/azure-cli/bin/az; \
    chmod 0755 /opt/azure-cli/bin/az; \
    SCRATCH=$(mktemp -d); AZURE_CONFIG_DIR="$SCRATCH" AZURE_CORE_COLLECT_TELEMETRY=false /opt/azure-cli/bin/az version --output json; rm -rf "$SCRATCH" /tmp/python.tar.gz

# --- the image -------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
ARG WEB_VERSION=0.8.0
LABEL org.opencontainers.image.title="Orbit Web" \
      org.opencontainers.image.description="Self-hosted, browser-based Claude Code with the Orbit plugin." \
      org.opencontainers.image.version="${WEB_VERSION}" \
      org.opencontainers.image.source="https://github.com/cuongngoht/orbit" \
      org.opencontainers.image.licenses="MIT"

# The runtime user, and the persistent directories it owns alone (a named volume is initialised from these).
RUN groupadd --system --gid 10001 orbit \
 && useradd --system --uid 10001 --gid orbit --home-dir /data/home --no-create-home --shell /usr/sbin/nologin orbit \
 && mkdir -p /data/app /data/claude /data/github /data/azure /data/orbit /data/sessions /data/workspaces /data/home \
 && chown -R orbit:orbit /data \
 && chmod 0700 /data/app /data/claude /data/github /data/azure /data/orbit /data/sessions /data/workspaces /data/home

COPY --from=tools /opt/tini /usr/local/bin/tini
COPY --from=tools /opt/gh /opt/gh
COPY --from=tools /opt/claude /opt/claude
COPY --from=azure /opt/azure-cli /opt/azure-cli
COPY --from=plugin /opt/orbit /opt/orbit
COPY --from=runtime-deps /opt/orbit-web /opt/orbit-web
COPY --from=build /src/packages/contracts/dist /opt/orbit-web/packages/contracts/dist
COPY --from=build /src/apps/api/dist /opt/orbit-web/apps/api/dist
COPY --from=build /src/apps/web/dist /opt/orbit-web/apps/web/dist
COPY integrations/orbit-web/docker/healthcheck.mjs integrations/orbit-web/docker/build-info.mjs /opt/orbit-web/docker/
# The git credential helper of an Azure Repos clone (docker/git-credential-azure-cli.mjs): named on that one git
# command by Orbit Web, never configured anywhere.
COPY --chmod=0755 integrations/orbit-web/docker/git-credential-azure-cli.mjs /opt/orbit-web/docker/git-credential-azure-cli.mjs

# CLAUDE_CONFIG_DIR: where the Claude CLI keeps its sign-in -- Orbit Web's own sign-in -- for every `claude` in the
# container, so a terminal sign-in (`docker exec -it orbit-web claude auth login --claudeai`) lands where Orbit Web
# reads it. Orbit Web also names it for each Claude process it starts.
ENV PATH=/opt/claude/bin:/opt/gh/bin:/opt/azure-cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_ENV=production \
    HOME=/data/home \
    CLAUDE_CONFIG_DIR=/data/claude \
    NO_COLOR=1 \
    DISABLE_AUTOUPDATER=1 \
    ORBIT_WEB_BIND=0.0.0.0 \
    ORBIT_WEB_PORT=3000 \
    ORBIT_WEB_DATA_DIR=/data \
    ORBIT_PLUGIN_DIR=/opt/orbit/plugin \
    ORBIT_WEB_STATIC_DIR=/opt/orbit-web/apps/web/dist \
    ORBIT_WEB_BUILD_INFO=/opt/orbit-web/build-info.json

RUN node /opt/orbit-web/docker/build-info.mjs "${WEB_VERSION}" > /opt/orbit-web/build-info.json \
 && cat /opt/orbit-web/build-info.json

USER orbit
WORKDIR /data/home
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD ["node", "/opt/orbit-web/docker/healthcheck.mjs"]
ENTRYPOINT ["/usr/local/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "/opt/orbit-web/apps/api/dist/main.js"]
