# The benchmark's QA WORKER image: what a QA case's generated tests run in, inside the isolated sandbox Orbit's own
# engine starts for the application -- Node and the browser CLI the engine drives (@playwright/cli, pinned to the
# version acceptance/worker pins) with a Chromium build and the system libraries it needs. It starts from the official
# Playwright image, pinned by digest, so nothing is fetched from an OS package mirror or a browser CDN: on a network
# that reaches only a registry, it still builds. Nothing of Orbit is in it: the engine mounts the plugin read-only when
# a test runs. benchmark/run.mjs builds it (`build --qa-worker`), tags it by this directory's digest and pins every run
# to the image id the build gave; the run trusts that id the way a person trusts a worker image in Orbit Control.
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

COPY link-browsers.mjs /usr/local/lib/orbit-benchmark/link-browsers.mjs

# A person behind a TLS-inspecting proxy hands its CA as a build SECRET (`build --ca-file=<pem>`): read for this one
# step, never written into a layer. The CLI's own Playwright may name a Chromium revision a release or two from the one
# the image ships: link-browsers.mjs points the revision the CLI names at the one that is there, and says so.
RUN --mount=type=secret,id=orbit-ca,required=false \
    if [ -f /run/secrets/orbit-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/orbit-ca; fi \
 && npm install -g @playwright/cli@0.1.22 \
 && node /usr/local/lib/orbit-benchmark/link-browsers.mjs "$(npm root -g)/@playwright/cli/node_modules/playwright-core/browsers.json" \
 && playwright-cli --version \
 && rm -rf /root/.npm /root/.cache

LABEL orbit.benchmark.image="qa-worker" \
      orbit.benchmark.browser-cli="0.1.22"
