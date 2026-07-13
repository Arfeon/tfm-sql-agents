# Guía avanzada de instalación e infraestructura

Todo lo que la [guía de instalación](instalacion.md) hace por ti automáticamente,
explicado para controlarlo a mano: levantar la infraestructura con Docker Compose,
verificar cada pieza, entender el init y regenerar los datos. Nada de esto es
necesario para usar GraphSQL — es para quien quiere mirar debajo del capó.

Los comandos son los mismos en Windows (PowerShell), Linux y macOS; los requisitos
y las diferencias por sistema operativo están en la
[guía paso a paso, §1](instalacion-paso-a-paso.md#1-instala-los-requisitos-una-sola-vez).

## Levantar la infraestructura a mano

Desde la raíz del proyecto:

```bash
docker compose up -d --wait
```

El `--wait` hace que el comando no termine hasta que los dos servicios están
levantados **y sanos** (`healthy`): cuando te devuelve el prompt, ya puedes usar
el CLI. El primer arranque tarda **en torno a un minuto** (crea las bases de datos,
carga los datos de prueba — los dumps van en lotes de 1000 filas, así que son
segundos — y Neo4j descarga el plugin APOC; si además tiene que bajar las imágenes
de Docker, algo más). Los siguientes arranques son cuestión de segundos.

Ojo en **equipos muy lentos**: el `--wait` depende del `start_period` del healthcheck
(300 s); si el primer arranque tardara más, el comando falla con el init aún en marcha.
El CLI (`npm start`) no tiene ese límite — vigila la **actividad** del init y sigue
esperando mientras avance —, así que en un equipo modesto es la opción cómoda. Si
prefieres hacerlo a mano, usa `docker compose up` en primer plano para verlo en
directo, o sube el `start_period` en `docker-compose.yml`.

Esto arranca dos servicios:

| Servicio   | Qué es                        | Dónde lo encuentras            |
|------------|-------------------------------|--------------------------------|
| `postgres` | PostgreSQL **con pgvector**   | `localhost:5432`               |
| `neo4j`    | Base de datos de grafos Neo4j | `localhost:7474` (navegador)   |

Hay un tercer servicio, `cli`, bajo el profile `demo`: la aplicación empaquetada en
una imagen Docker para evaluar la demo sin Node (`docker compose --profile demo run
--rm cli`). El `up -d` de siempre no lo toca; el detalle está en la
[guía de la demo con Docker](instalacion-docker.md).

Para comprobar su estado en cualquier momento:

```bash
docker compose ps
```

Las contraseñas salen del `.env` de la raíz: Docker Compose y el backend leen el
**mismo fichero**, así que siempre coinciden. Si cambias una contraseña con los
volúmenes ya creados, tendrás que empezar de cero (`docker compose down -v`),
porque Postgres/Neo4j se inicializan con la contraseña del primer arranque.

### Sobre pgvector

**No hay que instalar nada.** La imagen `pgvector/pgvector:pg16` ya trae pgvector
incluido, y el script de arranque lo activa automáticamente la primera vez.

## Qué hace el init (primer arranque)

Al detectar el volumen vacío, Postgres ejecuta `setup/infra/postgres/init/01-init.sh`,
que crea las tres bases de datos y lanza en este orden:

1. `02-schema.sql` — crea las 17 tablas de `arcadia`.
2. `04-nebula-schema.sql` + `05-nebula-dataset.sql` — esquema (66 tablas) y datos
   ligeros de `nebula`, la BD grande sintética de la prueba de escala (SPEC-17).
3. `03-dataset.sql` — inserta los datos de `arcadia` (60 compañías, 320 juegos, 5 000
   clientes, 80 000 sesiones de juego…) **al final**, con un monitor de progreso en la
   terminal. Los dos datasets son dumps de `pg_dump --rows-per-insert=1000`: cada
   INSERT confirma un lote de 1 000 filas, así que la carga entera son segundos
   (fila a fila eran ~195 000 transacciones, y en discos lentos, decenas de minutos).

Al terminar TODO, el script crea un **marcador** (`setup_init_complete` en
`graphsql_memory`) que el healthcheck del compose exige: si el init se interrumpe a
medias, el contenedor queda `unhealthy` **a propósito** — Postgres nunca reintenta los
scripts sobre un volumen no vacío, y sin el marcador el fallo sería silencioso (servidor
que responde, bases de prueba que no existen). La recuperación es empezar de cero:
`docker compose down -v && docker compose up -d --wait` (el CLI lo ofrece él solo).

Las tres bases resultantes:

- `graphsql_memory` → memoria interna del sistema (índice vectorial y checkpoints).
- `arcadia` → la base de pruebas de uso diario (17 tablas).
- `nebula` → la base grande sintética de la prueba de escala (66 tablas).

## Verificar cada pieza

```bash
# ¿Los datos de Arcadia están cargados?
docker exec graphsql_postgres psql -U postgres -d arcadia -c "SELECT COUNT(*) FROM game;"
# Debe devolver 320

# Tests unitarios (no necesitan Docker) y diagnóstico del entorno (sí lo necesita)
cd backend
npm test                  # 200+ tests en verde, en segundos
npm run test:diagnostic   # comprueba Postgres, las 17 tablas de arcadia y pgvector
```

También puedes mirar el grafo del esquema en el navegador de Neo4j
(`localhost:7474`, usuario y contraseña del `.env`):

```cypher
MATCH (t:Table)-[r:REFERENCES]->(other:Table) RETURN t, r, other
```

## Comandos útiles del día a día

```bash
docker compose stop          # parar las bases de datos (conserva los datos)
docker compose start         # volver a arrancarlas
docker compose down          # parar y borrar los contenedores (conserva los datos)
docker compose down -v       # borrar TODO, incluidos los datos (empezar de cero)
docker compose logs -f neo4j # ver los logs de un servicio
```

> Ojo con `docker compose up` **sin `-d`**: deja el log en primer plano y un Ctrl+C
> ahí **detiene los contenedores**. Para el uso normal, `-d --wait` (o simplemente
> deja que `npm start` lo gestione).

## (Opcional) Regenerar los datos de prueba

Los `*-dataset.sql` commiteados bastan para reproducir las BDs. Los seeders
reproducibles (seed=42) viven en `backend/src/datasets/` y usan las dependencias del
propio backend. Solo hacen falta si cambias el esquema o el volumen de datos:

```bash
# Desde backend/
npm run seed -- --truncate          # repuebla arcadia (TARGET_DB_1)
npm run seed:nebula -- --reset      # recrea el esquema de nebula y la repuebla (TARGET_DB_2)

# Exportar los dataset.sql (arcadia y/o nebula)
docker exec graphsql_postgres pg_dump -U postgres --data-only --column-inserts --no-comments arcadia \
  > ../setup/infra/postgres/init/sql/03-dataset.sql
docker exec graphsql_postgres pg_dump -U postgres --data-only --column-inserts --no-comments nebula \
  > ../setup/infra/postgres/init/sql/05-nebula-dataset.sql
```

Después haz commit de los archivos modificados y el próximo arranque desde cero ya
usará los datos nuevos.

## Problemas frecuentes

- **El puerto 5432 o 7687 está ocupado**: tienes otro PostgreSQL/Neo4j corriendo.
  Páralo, o cambia el puerto publicado en `docker-compose.yml` (el lado izquierdo
  del `:`) y su variable correspondiente en el `.env`.
- **Error de contraseña al conectar**: cambiaste la contraseña del `.env` con los
  volúmenes ya inicializados. `docker compose down -v` y vuelve a empezar (se pierden
  los datos, que se regeneran solos).
- **Cambié el init pero no se aplica**: los scripts de `setup/infra/postgres/init/`
  solo se ejecutan cuando el volumen está vacío. `docker compose down -v` y arranca
  de nuevo.
- **`npm install` falla con `node-gyp`**: asegúrate de tener Node.js 20+ y de que no
  hay versiones conflictivas instaladas.
- **El contenedor sale `unhealthy` en el primer arranque**: dos causas posibles. (1) El
  init anterior se **interrumpió a medias** — el healthcheck exige el marcador de init
  completo y no lo encuentra: `docker compose down -v` y vuelve a empezar. (2) Tu máquina
  es muy lenta y la carga inicial supera el margen del healthcheck (`start_period`, 300 s).
  En este segundo caso **no hay que tocar nada si arrancas con el CLI**: `npm start` no
  usa ese margen, vigila la actividad del init y espera lo que haga falta. Solo si
  levantas a mano con `--wait` te afecta: sube el `start_period` en `docker-compose.yml`
  o usa `docker compose up` en primer plano. Comprueba con
  `docker logs -f graphsql_postgres` si los contadores siguen creciendo: si crecen, la
  carga va bien aunque el estado diga `unhealthy` — al terminar pasará a `healthy` solo.
