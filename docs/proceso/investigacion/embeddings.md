# Embeddings — por qué y cómo encaja

- **Fecha**: 2026-06-27
- **Decisión formal (resumen)**: [`docs/design/arquitectura.md`](../../design/arquitectura.md) §6

## Por qué encaja

Necesito encontrar las tablas relevantes para una pregunta cuando el usuario **no usa los nombres exactos del esquema**: pregunta por "clientes" y la tabla se llama `customer`, o pregunta en español sobre un esquema en inglés. La búsqueda por palabra clave no resuelve esto; la **búsqueda semántica** (embeddings) sí: mapea texto a un vector y mide cercanía de significado, no de letras.

Esto es la mitad del GraphRAG: pgvector encuentra las tablas **candidatas** por significado; el grafo de Neo4j luego **expande por las FKs** hasta las relacionadas. Cada pieza resuelve un problema distinto.

## El principio que condiciona todo: mismo modelo para indexar y consultar

Un modelo de embeddings proyecta el texto en **su propio espacio vectorial**. La similitud (coseno) solo tiene sentido **entre vectores del mismo espacio**. Por tanto, **tengo que indexar las tablas y consultar la pregunta con el MISMO modelo**; si mezclo modelos, las distancias no significan nada y la recuperación es basura.

Dos consecuencias:

1. El modelo de embeddings es una **propiedad del índice**, no una elección por consulta. Cambiar de modelo obliga a **re-vectorizar todo**.
2. La **dimensión** debe coincidir: la columna pgvector es `vector(N)` fija. No puedo mezclar vectores de distinta dimensión.

Para protegerme de mezclas, **guardo junto a cada vector el nombre del modelo (y la dimensión)** con el que se generó: si el modelo activo no coincide con el que indexó, aviso/re-vectorizo en vez de devolver resultados sin sentido.

## Opciones

| Proveedor | Modelo | Dims | Multilingüe (ES→EN) |
|---|---|---|---|
| OpenAI | `text-embedding-3-small` | 1536 | Sí, bueno |
| OpenAI | `text-embedding-3-large` | 3072 | Sí, mejor (más caro) |
| Local (LM Studio) | `bge-m3` | 1024 | Sí, fuerte (diseñado multilingüe) |
| Local (LM Studio) | `multilingual-e5-large` | 1024 | Sí |
| Local (LM Studio) | `nomic-embed-text` | 768 | Flojo (sobre todo inglés) |

Dos hechos que pesan en mi caso:

- Mis preguntas van en **español** y el esquema en **inglés** → necesito un modelo **multilingüe**. Eso descarta `nomic` y favorece `text-embedding-3-*` o, en local, `bge-m3`.
- LM Studio expone embeddings por el endpoint **OpenAI-compatible** `/v1/embeddings`. Igual que con el chat, **un único adaptador parametrizado por `baseURL`** me sirve para OpenAI y para local.

## Cómo encaja en el flujo

- **Indexación** (al escanear el esquema): por cada tabla compongo un texto (`Tabla: <nombre>. Columnas: <...>`) y, si hay descripciones disponibles (ver «Descripciones opcionales»), las añado; lo embebo y lo guardo en pgvector con el modelo/dims usados. La **descripción cruda** también se guarda en su propia columna, para poder buscarla o mostrarla por texto (no solo por similitud).
- **Recuperación** (Schema Agent): embebo la pregunta con el **mismo modelo que indexó** —lo leo del índice (proveedor/modelo/dimensión guardados), no lo elijo al chatear— y busco por similitud coseno las tablas candidatas (umbral + límite); luego paso esas tablas al grafo para expandir por FKs.

## Decisión

- Puerto **`IEmbeddings`** + factory (OpenAI / local), espejo del patrón de `IChatModel`. Un adaptador OpenAI-compatible parametrizado por `baseURL` cubre ambos.
- Config: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`. La dimensión de la columna pgvector es configurable.
- **Por defecto**: OpenAI `text-embedding-3-small` (1536). Para el camino 100% local: `bge-m3` (1024).
- Guardo el **proveedor + modelo + dimensión con cada vector**: impide mezclas y deja el índice autodescrito, para que al consultar reconstruya el mismo modelo sin que el usuario lo elija.

**Re-vectorización: siempre explícita, nunca automática.** Vectorizar (la primera vez o al cambiar de modelo) lo dispara el usuario, con un aviso claro antes de proceder:

- Si el proveedor activo es **OpenAI**, advierto **en rojo que tiene coste**.
- En ambos casos (OpenAI y local) indico que **tardará ~X minutos** en vectorizar todo.
- Si detecto que el modelo activo no coincide con el que indexó (mismatch de modelo/dims), **no re-vectorizo solo**: muestro el aviso y pido que el usuario confirme la re-vectorización.

**Descripciones opcionales (enriquecer la vectorización).** El usuario puede dejar en una carpeta (`descriptions/`) un fichero JSON con un **array** de objetos `{ tableName, description }` — fácil de recorrer y claro de rellenar:

```json
[
  { "tableName": "game", "description": "Catálogo de juegos de la plataforma." },
  { "tableName": "company", "description": "Empresas; pueden ser desarrolladoras y/o editoras." }
]
```

Al vectorizar:

- Si hay un fichero de descripciones, **pregunto si incluirlas** en el texto que se embebe (mejora la búsqueda, sobre todo ES→EN).
- Si no, vectorizo solo con nombre + columnas.
- Dejo un `descriptions/descriptions.example.json` como **guía del formato**; la detección lo **ignora**, así que no dispara el aviso por sí solo.

## Dudas / cuestiones de diseño abiertas

- **Calidad de recuperación**: ajustar el umbral de similitud y el `limit` con el golden set; es donde se va el tiempo "fino".
