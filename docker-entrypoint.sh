#!/bin/sh
set -e

# db-config.json aus Umgebungsvariablen generieren (wenn DB_TYPE gesetzt)
if [ "$DB_TYPE" = "postgresql" ]; then
    cat > /app/db-config.json <<EOF
{
  "type": "postgresql",
  "host": "${DB_HOST:-localhost}",
  "port": ${DB_PORT:-5432},
  "user": "${DB_USER:-tradenote}",
  "password": "${DB_PASSWORD:-}",
  "database": "${DB_NAME:-tradenote}"
}
EOF
    echo "-> PostgreSQL: ${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-tradenote}"
else
    echo "-> SQLite: /app/data/tradenote.db"
    # Symlink damit SQLite in den persistenten Volume-Ordner schreibt
    if [ ! -f /app/tradenote.db ] && [ -d /app/data ]; then
        ln -sf /app/data/tradenote.db /app/tradenote.db
    fi
fi

exec "$@"
