# Guía de instalación

Cómo dejar el entorno listo desde cero: las dos bases de datos (PostgreSQL + Neo4j)
con Docker y la base de pruebas **Arcadia** cargada. Sigue los pasos en orden.

## 1. Requisitos previos

Instala estas tres cosas (si no las tienes ya):

- **Docker Desktop** — para levantar PostgreSQL y Neo4j sin instalarlos a mano.
  https://www.docker.com/products/docker-desktop/
- **Node.js 18 o superior** — para el seeder y los tests de diagnóstico.
- **Git** — para clonar el repositorio.

Comprueba que Docker y Node responden:

```bash
docker --version
node --version
```

## 2. Clonar el proyecto y preparar el `.env`

```bash
git clone <url-del-repo>
cd tfm-sql-agents
cp .env.example .env
```

Abre el `.env` y, como mínimo, pon una contraseña en estas variables (la que tú
quieras, pero **apúntala** porque la usarás en Docker):

```ini
POSTGRES_PASSWORD=TuContraseña
NEO4J_PASSWORD=TuContraseña
```

> El `docker-compose.yml` ya viene con una contraseña por defecto. Si la cambias en
> el `.env`, cámbiala también en `docker-compose.yml` para que coincidan.

## 3. Levantar las bases de datos con Docker

Desde la raíz del proyecto:

```bash
docker compose up -d
```

La primera vez tarda un poco (descarga las imágenes). Esto arranca dos servicios:

| Servicio   | Qué es                        | Dónde lo encuentras            |
|------------|-------------------------------|--------------------------------|
| `postgres` | PostgreSQL **con pgvector**   | `localhost:5432`               |
| `neo4j`    | Base de datos de grafos Neo4j | `localhost:7474` (navegador)   |

Comprueba que los dos están en marcha y sanos (`healthy`):

```bash
docker compose ps
```

### Sobre pgvector

**No tienes que instalar nada.** La imagen `pgvector/pgvector:pg16` ya trae pgvector
incluido, y un script de arranque (`setup/infra/postgres/init/01-init.sh`) lo activa
automáticamente la primera vez. Ese mismo script crea las dos bases de datos:

- `graphsql_memory` → memoria interna del sistema.
- `arcadia` → la base de pruebas que vamos a consultar.

## 4. Verificar que la base de datos está lista

El `docker compose up` del paso anterior **ya carga las tablas y los datos
automáticamente**. No hay que ejecutar nada más. Al arrancar por primera vez,
Postgres detecta el volumen vacío y ejecuta en orden:

1. `01-init.sh` — crea la BD `arcadia` y activa pgvector.
2. `02-schema.sql` — crea las 16 tablas.
3. `03-dataset.sql` — inserta todos los datos (60 compañías, 320 juegos, 5 000
   clientes, 80 000 sesiones de juego…).

Puedes comprobarlo con:

```bash
docker exec graphsql_postgres psql -U postgres -d arcadia -c "SELECT COUNT(*) FROM game;"
# Debe devolver 320
```

## 5. Instalar dependencias y ejecutar los tests de diagnóstico

```bash
cd backend
npm install
npm test
```

Los tests comprueban que Postgres responde, que la BD `arcadia` tiene las 16 tablas
con los volúmenes de datos esperados y que pgvector está activo.

## 6. (Opcional) Regenerar los datos

El archivo `setup/infra/postgres/init/03-dataset.sql` está commiteado en el repo y es
suficiente para reproducir la BD. Solo necesitas tocar `seedData.ts` si cambias
el esquema o quieres generar un volumen distinto de datos:

```bash
# Desde el directorio backend/
npm run seed -- --truncate

# Exportar el nuevo dataset.sql
docker exec graphsql_postgres pg_dump \
  -U postgres --data-only --column-inserts --no-comments arcadia \
  > ../setup/infra/postgres/init/sql/03-dataset.sql
```

Después haz commit de los archivos modificados y el próximo `docker compose up`
desde cero ya usará los datos nuevos.

## Comandos útiles

```bash
docker compose stop          # parar las bases de datos (conserva los datos)
docker compose start         # volver a arrancarlas
docker compose down          # parar y borrar los contenedores (conserva los datos)
docker compose down -v       # borrar TODO, incluidos los datos (empezar de cero)
docker compose logs -f neo4j # ver los logs de un servicio
```

## Problemas frecuentes

- **El puerto 5432 o 7687 está ocupado**: tienes otro PostgreSQL/Neo4j corriendo.
  Páralo, o cambia el puerto en `docker-compose.yml` (lado izquierdo del `:`).
- **Error de contraseña al poblar**: la contraseña del `.env` no coincide con la del
  `docker-compose.yml`. Revisa que sean iguales.
- **`npm install` falla con `node-gyp`**: asegúrate de tener Node.js 18+ y que
  no hay versiones conflictivas instaladas.
- **Cambié el init pero no se aplica**: los scripts de `setup/infra/postgres/init/` solo se
  ejecutan cuando el volumen está vacío. Haz `docker compose down -v` y vuelve a
  levantar para forzarlo.
