# The synthetic invoice application, stack B: one image for every role (app/main.mjs supervises
# them all). Its scheduler runs on this machine's time (CLOCK_INJECTION=none): there is no business
# clock to move, so a period is reached by real time or dispatched through the trigger hook. The
# image holds no secret and its test hooks are OFF: whoever runs it sets the broker credential
# (NATS_USER, NATS_PASSWORD), ORBIT_SINK_TOKEN and -- only for a test -- ORBIT_TEST_HOOKS=on with
# ORBIT_TEST_HOOKS_TOKEN. Every other default a role needs is set here.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

ENV NODE_ENV=production \
    PGHOST=db \
    PGPORT=5432 \
    PGUSER=invoice \
    PGDATABASE=invoice \
    NATS_HOST=broker \
    NATS_PORT=4222 \
    INVOICE_TRANSPORT=/app/transport.mjs \
    SINK_URL=http://127.0.0.1:8081 \
    CLOCK_INJECTION=none

COPY package.json transport.mjs nats.mjs ./
COPY contracts ./contracts
COPY app ./app

USER node

# 8080 the API and its page · 8081 the synthetic notification sink · 9090 the test hooks (when on)
EXPOSE 8080 8081 9090

HEALTHCHECK --interval=2s --timeout=3s --start-period=5s --retries=60 CMD ["node", "app/main.mjs", "health"]

CMD ["node", "app/main.mjs", "all"]
