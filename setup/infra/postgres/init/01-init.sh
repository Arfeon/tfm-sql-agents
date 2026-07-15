#!/bin/bash
# Init de Postgres (se ejecuta solo en el PRIMER arranque, con el volumen vacío).
# Crea la BD `arcadia`, activa pgvector en ambas bases, y carga el esquema + datos.
set -euo pipefail

# Ruta fija en lugar de dirname "$0": si este script no tiene bit de ejecución, el
# entrypoint de Postgres lo *sourcea* en vez de ejecutarlo, y entonces "$0" es el del
# propio entrypoint (/usr/local/bin/docker-entrypoint.sh) → dirname daría /usr/local/bin
# y los .sql no se encontrarían. Es lo que pasaba en Linux, donde el fichero llega como
# 0644 (en el bind-mount de Docker Desktop en Windows salía 0777 y sí se ejecutaba). Este
# es el directorio donde Postgres monta/hornea siempre los scripts de init, así que la
# ruta es estable tanto si el script se ejecuta como si se sourcea.
SCRIPT_DIR="/docker-entrypoint-initdb.d"
PG="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER"

echo "══════════════════════════════════════"
echo "  GraphSQL — Init de Postgres"
echo "══════════════════════════════════════"

# ── 1. Crear BDs arcadia y nebula ─────────────────────────────────────────────
echo "[1/3] Creando bases de datos arcadia y nebula..."
$PG --dbname postgres <<-EOSQL
    CREATE DATABASE arcadia;
    CREATE DATABASE nebula;
EOSQL

# ── 2. Activar pgvector en ambas bases ───────────────────────────────────────
echo "[2/3] Activando pgvector en $POSTGRES_DB y arcadia..."
for db in "$POSTGRES_DB" arcadia; do
    $PG --dbname "$db" <<-EOSQL
        CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
done

# ── 3. Esquema ───────────────────────────────────────────────────────────────
echo "[3/3] Cargando esquema de arcadia (02-schema.sql)..."
$PG --dbname arcadia -f "$SCRIPT_DIR/sql/02-schema.sql"
echo "      Esquema de arcadia listo."

# Nebula: BD grande sintética para la prueba de escala (SPEC-17). Esquema (66 tablas) +
# datos ligeros sembrados (seed=42), para poder medir también la execution accuracy.
echo "      Cargando esquema de nebula (04-nebula-schema.sql)..."
$PG --dbname nebula -f "$SCRIPT_DIR/sql/04-nebula-schema.sql"
echo "      Cargando datos de nebula (05-nebula-dataset.sql)..."
$PG --dbname nebula -q -f "$SCRIPT_DIR/sql/05-nebula-dataset.sql"
echo "      Nebula lista (66 tablas, datos ligeros)."

# ── 4. Datos (con monitor de progreso) ───────────────────────────────────────
# El dump usa INSERTs por lotes de 1000 filas (pg_dump --rows-per-insert=1000):
# cada lote se confirma con autocommit, así que el monitor ve crecer los
# contadores y la carga completa tarda segundos, no minutos (antes era fila a
# fila: 180k transacciones y varios minutos, media hora en equipos modestos).
echo ""
echo "  Cargando datos — 03-dataset.sql (unos segundos):"
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

# ── 5. Marcador de init completo ─────────────────────────────────────────────
# El healthcheck del compose exige esta tabla: si el init se interrumpe a medias
# (Ctrl+C durante la carga), el volumen queda no-vacío y Postgres NUNCA reintenta
# los scripts — sin el marcador, el contenedor queda "unhealthy" y el fallo se ve,
# en vez de arrancar sin datos y sin error. El preflight del CLI ofrece el reset.
$PG --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE TABLE IF NOT EXISTS setup_init_complete (completed_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO setup_init_complete DEFAULT VALUES;
EOSQL

# ── 6. Resumen final ─────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════"
echo "  arcadia — datos cargados (seed=42)"
echo "══════════════════════════════════════"
psql --username "$POSTGRES_USER" --dbname arcadia -c "
    SELECT relname AS tabla, n_live_tup AS filas
    FROM   pg_stat_user_tables
    WHERE  schemaname = 'public'
    ORDER  BY filas DESC;
" 2>/dev/null || true

echo ""
echo "  pgvector activo en: $POSTGRES_DB, arcadia"
echo "══════════════════════════════════════"
