# The acceptance run's WORKER image for a page test (doc §15.1): Node 22 on glibc (the browser the engine drives does
# not run on musl), the browser CLI the engine drives -- @playwright/cli, pinned -- and the Chromium build that CLI was
# made for, with the system libraries it needs. Nothing of Orbit is in it: the plugin is mounted read-only when a test
# runs. acceptance/run.mjs builds it, pins it by the image id it gets, and trusts that id the way a person trusts a
# worker image in Orbit Control.
FROM node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN npm install -g @playwright/cli@0.1.22 \
 && node /usr/local/lib/node_modules/@playwright/cli/node_modules/playwright/cli.js install --with-deps chromium \
 && playwright-cli --version \
 && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache
