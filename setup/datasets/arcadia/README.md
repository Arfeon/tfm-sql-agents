# Arcadia — base de datos objetivo del TFM

> **Estado: validado.** Levanté el esquema en PostgreSQL 16 + pgvector (vía
> `docker-compose.yml`), poblé con `seed_data.py` (seed=42: 60 compañías, 320 juegos,
> 5 000 clientes, 80 000 sesiones, 55 000 snapshots) y ejecuté las 24 consultas del
> golden set contra la BD real: **24/24 corren y devuelven filas**. El proceso me
> destapó un bug en el seeder (PK de `subscription_plan`) y dos preguntas frágiles
> que corregí (G-14 sin editoras puras, G-19 con umbral inalcanzable).

Base de datos **propia** (decisión D-03) que sirve de banco de pruebas para el
sistema NL→SQL. Modela una **plataforma de suscripción de videojuegos en
streaming** ("Netflix de videojuegos"): catálogo de juegos incluidos en la
suscripción, compras puntuales de DLC y telemetría de uso.

## Por qué este dominio

- **Nombres sintéticos.** Juegos y compañías inventados (no son reales), así que el
  dataset no depende de conocimiento previo que pueda tener el modelo.
- **Estructura de grafo natural.** Tablas unidas por claves foráneas (compañías,
  franquicias, juegos, géneros, plataformas, clientes, suscripciones, telemetría):
  un buen caso para **vectorizar toda la base de datos y navegarla gráficamente en
  Neo4j**, que es donde se aprecia el valor en bases de datos grandes.
- **Rico en métricas.** Ingresos (MRR de suscripción + DLC), jugadores
  concurrentes, playtime, valoraciones, churn y retención → preguntas variadas.
- **Multilingüe.** Esquema en inglés, preguntas en español (caso del TFM).

## Esquema (16 tablas)

```
company ──< franchise                 game >── company  (developer / publisher)
   │                                   │
   └──< game >── franchise             ├──< game_genre >── genre
                                       ├──< game_platform >── platform
                                       └──< dlc

region ──< customer ──< subscription >── subscription_plan
              │                purchase >── dlc
              └──< play_session >── game / platform
              └──< rating >── game
region / game ──< concurrent_snapshot
```

Definición completa y comentada en [schema.sql](schema.sql).

## Cómo levantarla

Requisitos: PostgreSQL local (Docker, ver infra del proyecto) y Python con
`psycopg2-binary` y `faker`.

```bash
# variables de conexión (o usar el .env del proyecto, TARGET_DB_*)
export TARGET_DB_HOST=localhost TARGET_DB_PORT=5432 \
       TARGET_DB_NAME=arcadia TARGET_DB_USER=postgres TARGET_DB_PASSWORD=postgres

# crear esquema + poblar en un paso (volumen medio, ~200k filas)
python seed_data.py --reset
```

El seeder es **reproducible** (`seed=42`): misma semilla → mismos datos. Volumen
medio (≈ 60 compañías, 320 juegos, 5 000 clientes, 80 000 sesiones, 55 000
snapshots de concurrencia). Ajustable en las constantes `N_*` de
[seed_data.py](seed_data.py).

> **Seguridad por diseño:** crea y puebla con un usuario con permisos de escritura,
> pero configura el agente para consultar con un usuario de **solo lectura** distinto.

## Golden set

[golden_set.yaml](golden_set.yaml) — 24 preguntas ES→SQL etiquetadas por
dificultad (`easy` / `medium` / `hard`) y con las tablas que la SQL correcta debe
tocar. La SQL de referencia es PostgreSQL de solo lectura; para comparar respuestas
es preferible contrastar el **resultado**, no el texto de la consulta.

Sirve para probar el sistema a mano mientras se desarrolla: desde lookups simples
hasta consultas multi-tabla (multi-hop de 3-4 tablas, anti-joins, agregaciones).
