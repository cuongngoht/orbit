# The synthetic invoice application, stack A: one image for every role (app/main.mjs supervises
# them all), with an INJECTED business clock (CLOCK_INJECTION=live). The image holds no secret and
# its test hooks are OFF: whoever runs it sets the broker credential (AMQP_USER, AMQP_PASSWORD),
# ORBIT_SINK_TOKEN and -- only for a test -- ORBIT_TEST_HOOKS=on with ORBIT_TEST_HOOKS_TOKEN. Every
# other default a role needs is set here.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

ENV NODE_ENV=production \
    PGHOST=db \
    PGPORT=5432 \
    PGUSER=invoice \
    PGDATABASE=invoice \
    AMQP_HOST=broker \
    AMQP_PORT=5672 \
    AMQP_VHOST=/ \
    INVOICE_TRANSPORT=/app/transport.mjs \
    SINK_URL=http://127.0.0.1:8081 \
    CLOCK_INJECTION=live \
    CLOCK_START=2026-10-22T08:00:00+07:00

COPY package.json transport.mjs ./
COPY vendor ./vendor
COPY contracts ./contracts
COPY app ./app

USER node

# 8080 the API and its page · 8081 the synthetic notification sink · 9090 the test hooks (when on)
EXPOSE 8080 8081 9090

HEALTHCHECK --interval=2s --timeout=3s --start-period=5s --retries=60 CMD ["node", "app/main.mjs", "health"]

CMD ["node", "app/main.mjs", "all"]
