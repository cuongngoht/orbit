# The benchmark RUNNER image: Node 22 on glibc (the same pinned base the acceptance worker uses), git, npm and the
# Claude Code CLI pinned to one version -- the coding host a repair round runs. Nothing of Orbit is in it: the subject
# is mounted read-only when a round runs, so one image serves every source and a new source never reuses an old one.
# benchmark/run.mjs builds it from this directory alone (no other file reaches the build context), tags it by this
# directory's digest and pins every run to the image id the build gave. No credential is baked in or passed to a build.
FROM node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8

ARG CLAUDE_CODE_VERSION=2.1.314

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# A person behind a TLS-inspecting proxy hands its CA as a build SECRET (`build --ca-file=<pem>`): read for this one
# step, never written into a layer.
RUN --mount=type=secret,id=orbit-ca,required=false \
    if [ -f /run/secrets/orbit-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/orbit-ca; fi \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && claude --version \
 && rm -rf /root/.npm /root/.cache /root/.claude /root/.claude.json

COPY npmrc /usr/local/etc/npmrc
COPY entry.mjs inspect.mjs preflight.mjs scripted.mjs session.mjs /bench/

LABEL orbit.benchmark.image="runner" \
      orbit.benchmark.claude-code="${CLAUDE_CODE_VERSION}"
