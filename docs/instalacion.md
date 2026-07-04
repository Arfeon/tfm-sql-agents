# Guía de instalación

Cómo dejar el entorno listo desde cero: los dos servidores (PostgreSQL + Neo4j) con
Docker y las bases de pruebas **Arcadia** (17 tablas, la de uso diario) y **Nebula**
(66 tablas, la de la prueba de escala) ya cargadas. Sigue los pasos en orden. Solo hay
**un `npm install`** (en `backend/`); todo lo demás es Docker y el `.env`. Al terminar,
la [guía de uso](uso.md) explica paso a paso cada función.

## 1. Requisitos previos

Instala estas tres cosas (si no las tienes ya):

- **Docker Desktop** — para levantar PostgreSQL y Neo4j sin instalarlos a mano.
  https://www.docker.com/products/docker-desktop/
- **Node.js 20 o superior** — para el seeder, el backend y los tests.
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

Abre el `.env` y configura dos cosas:

**a) Las contraseñas de las bases de datos** (la que tú quieras, pero **apúntala**
porque la usarás en Docker):

```ini
POSTGRES_PASSWORD=TuContraseña
NEO4J_PASSWORD=TuContraseña
```

> El `docker-compose.yml` ya viene con una contraseña por defecto. Si la cambias en
> el `.env`, cámbiala también en `docker-compose.yml` para que coincidan.

**b) El proveedor de LLM y de embeddings** — sin esto la base de datos se levanta,
pero el CLI no puede generar SQL ni vectorizar el esquema. Dos opciones:

```ini
# Opción nube (OpenAI): solo necesitas la API key
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
EMBEDDING_PROVIDER=openai

# Opción local (LM Studio): sin coste, necesitas LM Studio corriendo
# con un modelo de chat Y uno de embeddings cargados a la vez
LLM_PROVIDER=local
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
EMBEDDING_PROVIDER=local
```

Se pueden mezclar (p. ej. chat en OpenAI y embeddings locales, que es como está
medida la evaluación). El `.env.example` documenta todas las variables, incluidos
los modelos concretos de cada proveedor.

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
automáticamente la primera vez. Ese mismo script crea las tres bases de datos:

- `graphsql_memory` → memoria interna del sistema (índice vectorial y checkpoints).
- `arcadia` → la base de pruebas que consultamos a diario (17 tablas).
- `nebula` → la base grande sintética de la prueba de escala (66 tablas).

## 4. Verificar que la base de datos está lista

El `docker compose up` del paso anterior **ya carga las tablas y los datos
automáticamente**. No hay que ejecutar nada más. Al arrancar por primera vez,
Postgres detecta el volumen vacío y ejecuta en orden:

1. `01-init.sh` — crea las BDs `arcadia` y `nebula`, y activa pgvector.
2. `02-schema.sql` — crea las 17 tablas de `arcadia`.
3. `03-dataset.sql` — inserta los datos de `arcadia` (60 compañías, 320 juegos, 5 000
   clientes, 80 000 sesiones de juego…).
4. `04-nebula-schema.sql` + `05-nebula-dataset.sql` — esquema (66 tablas) y datos
   ligeros de `nebula`, la BD grande sintética para la prueba de escala (SPEC-17).

Puedes comprobarlo con:

```bash
docker exec graphsql_postgres psql -U postgres -d arcadia -c "SELECT COUNT(*) FROM game;"
# Debe devolver 320
```

## 5. Instalar dependencias y verificar

Un solo `npm install`, en `backend/` (los seeders y los scripts de evaluación usan
estas mismas dependencias; no hay más `package.json` en el repo):

```bash
cd backend
npm install
npm test                  # tests unitarios (rápidos, no necesitan Docker)
npm run test:diagnostic   # comprueba Postgres, las 17 tablas de arcadia y pgvector
```

Si los dos comandos salen en verde, el entorno está listo.

## 6. Primer arranque: escanear el esquema

Antes de la primera consulta hay que **escanear y vectorizar** el esquema (una vez,
y cada vez que cambie):

```bash
npm start        # → menú → "Escanear el esquema de la BD objetivo"
```

Elige Arcadia, acepta incluir las descripciones y confirma. A partir de ahí ya puedes
consultar en lenguaje natural — el paso a paso está en la [guía de uso](uso.md).

## 7. (Opcional) Regenerar los datos

Los `*-dataset.sql` commiteados bastan para reproducir las BDs. Los seeders reproducibles
(seed=42) viven en `backend/src/datasets/` (`seedArcadia.ts`, `seedNebula.ts`) y usan las
dependencias del propio backend (un solo `npm install`). Solo necesitas tocarlos si cambias
el esquema o el volumen de datos:

```bash
# Desde el directorio backend/
npm run seed -- --truncate          # repuebla arcadia (TARGET_DB_1)
npm run seed:nebula -- --reset      # recrea el esquema de nebula y la repuebla (TARGET_DB_2)

# Exportar los dataset.sql (arcadia y/o nebula)
docker exec graphsql_postgres pg_dump -U postgres --data-only --column-inserts --no-comments arcadia \
  > ../setup/infra/postgres/init/sql/03-dataset.sql
docker exec graphsql_postgres pg_dump -U postgres --data-only --column-inserts --no-comments nebula \
  > ../setup/infra/postgres/init/sql/05-nebula-dataset.sql
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
- **`npm install` falla con `node-gyp`**: asegúrate de tener Node.js 20+ y que
  no hay versiones conflictivas instaladas.
- **Cambié el init pero no se aplica**: los scripts de `setup/infra/postgres/init/` solo se
  ejecutan cuando el volumen está vacío. Haz `docker compose down -v` y vuelve a
  levantar para forzarlo.
