#!/bin/bash
# Init de Postgres (se ejecuta solo en el PRIMER arranque, con el volumen vacío).
# Crea la BD `arcadia`, activa pgvector en ambas bases, y carga el esquema + datos.
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
PG="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER"

echo "══════════════════════════════════════"
echo "  GraphSQL — Init de Postgres"
echo "══════════════════════════════════════"

# ── 1. Crear BD arcadia ──────────────────────────────────────────────────────
echo "[1/3] Creando base de datos arcadia..."
$PG --dbname postgres <<-EOSQL
    CREATE DATABASE arcadia;
EOSQL

# ── 2. Activar pgvector en ambas bases ───────────────────────────────────────
echo "[2/3] Activando pgvector en $POSTGRES_DB y arcadia..."
for db in "$POSTGRES_DB" arcadia; do
    $PG --dbname "$db" <<-EOSQL
        CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
done

# ── 3. Esquema ───────────────────────────────────────────────────────────────
echo "[3/3] Cargando esquema (02-schema.sql)..."
$PG --dbname arcadia -f "$SCRIPT_DIR/sql/02-schema.sql"
echo "      Esquema listo."

# ── 4. Datos (con monitor de progreso) ───────────────────────────────────────
echo ""
echo "  Cargando datos — 03-dataset.sql (esto tarda 1-3 minutos):"
echo "  Puedes ver el progreso en tiempo real porque cada INSERT"
echo "  se confirma con autocommit."
echo ""

# Lanzar la carga en background
$PG --dbname arcadia -q -f "$SCRIPT_DIR/sql/03-dataset.sql" &
DATA_PID=$!

# Monitor: consulta los contadores cada 4 segundos desde otra conexión
PREV_LINE=""
while kill -0 "$DATA_PID" 2>/dev/null; do
    sleep 4
    COUNTS=$(psql --username "$POSTGRES_USER" --dbname arcadia -t -A -c "
        SELECT format(
            '  company %-4s  franchise %-4s  game %-4s  customer %-5s  session %-6s',
            (SELECT COUNT(*) FROM company),
            (SELECT COUNT(*) FROM franchise),
            (SELECT COUNT(*) FROM game),
            (SELECT COUNT(*) FROM customer),
            (SELECT COUNT(*) FROM play_session)
        )
    " 2>/dev/null || echo "  (conectando...)")
    if [ "$COUNTS" != "$PREV_LINE" ]; then
        echo "$COUNTS"
        PREV_LINE="$COUNTS"
    fi
done

# Esperar a que termine y propagar el código de salida
wait "$DATA_PID"

# ── 5. Resumen final ─────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════"
echo "  arcadia — datos cargados (seed=42)"
echo "══════════════════════════════════════"
psql --username "$POSTGRES_USER" --dbname arcadia -c "
    SELECT tablename AS tabla, n_live_tup AS filas
    FROM   pg_stat_user_tables
    WHERE  schemaname = 'public'
    ORDER  BY filas DESC;
" 2>/dev/null || true

echo ""
echo "  pgvector activo en: $POSTGRES_DB, arcadia"
echo "══════════════════════════════════════"
