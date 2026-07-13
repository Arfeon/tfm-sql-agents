# Postgres de la demo con el init HORNEADO, para publicar en Docker Hub
# (pclota/graphsql-postgres-demo). En el compose del repo, los scripts de init se
# montan desde el clon; esta imagen los lleva dentro para que la demo se pueda
# instalar sin clonar nada (ver docker-compose.hub.yml en la raíz del repo).
# Solo contiene las bases de prueba sintéticas (arcadia y nebula): datos generados
# por seed, nada de datos reales.
#
#   docker build -t pclota/graphsql-postgres-demo setup/infra/postgres

FROM pgvector/pgvector:pg16
COPY init/ /docker-entrypoint-initdb.d/
