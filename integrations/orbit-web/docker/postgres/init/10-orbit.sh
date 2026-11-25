#!/bin/sh
# Run ONCE, by the PostgreSQL image, when its data volume is created empty (/docker-entrypoint-initdb.d), as the server's
# superuser: Orbit Web's own role (a login, never a superuser), its database owned by that role, and pgvector enabled in
# it -- the one step that needs a superuser. Orbit Web itself then creates its schemas and migrates them as its own role.
#
# The role's password comes from ORBIT_DB_PASSWORD (the compose file passes ORBIT_WEB_DB_PASSWORD), handed to psql as a
# variable and quoted by psql itself: it is never pasted into the SQL text.
set -eu

: "${ORBIT_DB_PASSWORD:?ORBIT_DB_PASSWORD must be set}"
ORBIT_DB_USER="${ORBIT_DB_USER:-orbit}"
ORBIT_DB_NAME="${ORBIT_DB_NAME:-orbit}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v role="$ORBIT_DB_USER" -v pw="$ORBIT_DB_PASSWORD" -v db="$ORBIT_DB_NAME" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"db" OWNER :"role";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$ORBIT_DB_NAME" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SQL
