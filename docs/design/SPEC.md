# Especificación de Implementación (SDD) — GraphSQL

> 🌱 **Documento incremental.** SDD aplicado de forma incremental: **cada componente se especifica justo antes de implementarlo** (*spec-first* por slice), no todo de golpe.

---

## 1. Principios rectores (metodología del curso)

Fijo estos principios **desde el inicio** porque son mi metodología de trabajo, no conocimiento del dominio técnico:

- **SDD (Spec-Driven Development)**: ningún componente se implementa sin su spec y sus criterios de aceptación; el alcance cambia editando la spec primero.
- **Clean Architecture**: dependencias hacia el dominio; el exterior (LLM, Neo4j, BD…) se accede mediante **puertos** implementados por **adaptadores** → todo testeable con dobles.
- **Clean Code**: nombres reveladores, funciones pequeñas, *type hints*, inyección de dependencias, sin números mágicos.
- **Seguridad por diseño**: solo lectura, allowlist, detección de inyección, aprobación humana, usuario de BD sin escritura.
- **TDD**: ciclo rojo → verde → refactor; un test por criterio de aceptación; nomenclatura `<unidad>_<condición>_<resultado>`.

## 2. Contexto y stack (visión general)

- **Lenguaje**: TypeScript (Node.js 20+). **Orquestación**: LangGraph.js. **Grafo**: Neo4j. **Memoria/checkpoints**: PostgreSQL + pgvector. **LLM**: configurable. **Interfaz**: CLI. **Tests**: Vitest.

## 3. Decisiones de diseño (D-xx)

> Las registro **a medida que las cierro**, con su justificación. (Plantilla: `D-NN | decisión | valor | estado`.)

| ID | Decisión | Justificación | Estado |
|----|----------|---------------|--------|
| D-01 | Stack: TypeScript + Node.js 20 | Más experiencia con el lenguaje; LangGraph.js cubre el mismo surface que necesito; la toolchain Node.js simplifica el entorno de desarrollo en Windows | ✅ Cerrada |
| D-02 | Puerto `ITargetDatabase` para la BD objetivo | Desacopla los agentes del driver `pg`; permite sustituir el adaptador en tests sin Docker; sigue el principio de inversión de dependencias de Clean Architecture | ✅ Cerrada |
| D-03 | Puerto `IChatModel` + factory para el proveedor LLM | Desacopla los agentes del proveedor concreto (OpenAI vs local); el factory centraliza qué adaptador instanciar según `LLM_PROVIDER`; mismo patrón puerto/adaptador que D-02 → testeable con dobles | ✅ Cerrada |
| D-04 | Cliente `ChatOpenAI` (LangChain) para ambos proveedores | LM Studio expone una API compatible con OpenAI: el mismo cliente sirve para la nube y para local cambiando solo `baseURL`; además es el cliente que reutilizaré al orquestar con LangGraph.js, así evito migrar después | ✅ Cerrada |

## 4. Especificaciones de componentes


| ID | Componente | Estado |
|----|-----------|--------|
| SPEC-00 | Infraestructura: BD objetivo (puerto + adaptador Postgres) | ✅ Cerrada |
| SPEC-00B | Infraestructura: proveedor LLM (puerto `IChatModel` + factory) | ✅ Cerrada |
| SPEC-00C | CLI inicial: punto de entrada, selección de proveedor y primera conversación | ✅ Cerrada |
| SPEC-01 | Primer grafo LangGraph: conversar y completar acciones (un nodo + una tool + checkpointer) | ✅ Cerrada |
| SPEC-02 | Ingesta del esquema: conectar a la BD objetivo, extraer su esquema y volcarlo a nodos Neo4j; tools para el agente | ✅ Cerrada |
| SPEC-03 | Vectorización del esquema: puerto `IEmbeddings` (OpenAI/local) + almacenamiento en pgvector + vectorizar al escanear | ✅ Cerrada |
| SPEC-04 | Schema Agent: recuperación (búsqueda semántica + expansión por FKs en el grafo) + tool de schema-linking | ⏳ Pendiente |
| SPEC-05 | SQL Agent (NL→SQL con el esquema recuperado) | ⏳ Pendiente |
| SPEC-06 | Judge Agent (seguridad: allowlist + EXPLAIN + juez LLM) | ⏳ Pendiente |
| SPEC-07 | Human Review (interrupt) integrado en el pipeline | ⏳ Pendiente |
| SPEC-08 | Execute SQL (solo lectura) | ⏳ Pendiente |
| SPEC-09 | Memory Agent / Store Feedback (opcional, primero en recortar) | ⏳ Pendiente |
| SPEC-10 | Supervisor (enrutador determinista) — al final, una vez existen las piezas | ⏳ Pendiente |
| SPEC-11 | Integración CLI completa + Evaluación experimental (ablation sobre el golden set) | ⏳ Pendiente |

---

### SPEC-00 — Conexión a la base de datos objetivo

**Objetivo.** Necesito una forma de que los agentes puedan consultar la base de datos sin que les importe si por debajo hay un `pg.Client` o cualquier otra cosa: dependen de una interfaz, no del driver.

**Contrato.** El puerto `ITargetDatabase` que conocerán los agentes expone dos métodos: `fetchAll(sql, params)`, que ejecuta cualquier SELECT y devuelve las filas, y `rowCount(table)`, que cuenta los registros de una tabla.

**Pasos**

1. Definir el puerto `ITargetDatabase` (`fetchAll`, `rowCount`).
2. Implementar el adaptador `PostgresTargetDatabase` que, al conectarse, fuerce la sesión en modo READ ONLY: aunque un agente cometa un error y trate de escribir, Postgres lo bloqueará a nivel de sesión antes de ejecutarlo.
3. Levantar la infraestructura con Docker Compose (Postgres + pgvector) y cargar el dataset Arcadia al arrancar el contenedor.
4. Escribir la suite de tests diagnóstico (Vitest) que verifique los criterios de abajo: conexión, bases de datos, pgvector, solo-lectura, esquema/conteos y ausencia de anomalías.

**Criterios de aceptación**

- [X] Tras `docker compose up -d`, el servidor Postgres responde
- [X] Existen las dos bases de datos que necesito: `arcadia` y `graphsql_memory`
- [X] pgvector está activo en `arcadia` (lo necesitaré más adelante para la memoria semántica)
- [X] La conexión a `arcadia` es de solo lectura: un INSERT debe fallar
- [X] El esquema de Arcadia tiene las 16 tablas esperadas
- [X] `game` tiene `developer_company_id` y `publisher_company_id` como columnas separadas
- [X] Los conteos de filas cuadran con el seed (`game`=320, `customer`=5000, etc.)
- [X] Los datos no tienen anomalías: age ratings válidos, sesiones con duración positiva, ratings entre 1 y 5

```bash
docker compose up -d
cd backend && npm run test:diagnostic
```

---

### SPEC-00B — Proveedor de modelo LLM (puerto + factory)

**Objetivo.** Todos los agentes van a necesitar hablar con un LLM, y quiero poder elegir entre la API de OpenAI (nube) y un modelo local servido por LM Studio sin que los agentes se enteren del cambio. Es la misma idea que `ITargetDatabase`: el agente depende de una interfaz, no del proveedor concreto.

**Contrato.** El puerto `IChatModel` que conocerán los agentes expone un único método `chat(messages)`: recibe una conversación (una lista de mensajes, cada uno con su rol —sistema, usuario o asistente— y su contenido de texto) y devuelve el texto de la respuesta del modelo.

**Pasos**

1. Crear el `enum LlmProvider` con los proveedores disponibles (`OpenAI`, `Local`); el valor de cada miembro será la cadena que espero en `LLM_PROVIDER`.
2. Definir el puerto `IChatModel` (`chat(messages) → texto`).
3. Implementar dos adaptadores separados, `OpenAIChatModel` y `LocalChatModel`, cada uno con un `fromEnv()` que lea **su propia** config del entorno (igual que `PostgresTargetDatabase.fromParams`). Como LM Studio expone una API compatible con OpenAI, ambos envolverán el mismo cliente `ChatOpenAI` de LangChain y el local solo cambiará el `baseURL`. Los mantengo separados para que el patrón quede explícito y poder añadir mañana un proveedor no compatible (Anthropic, Ollama nativo…) sin tocar a los agentes.
4. Crear el factory `ChatModelFactory` que, según el proveedor, construya **solo** ese adaptador (`create(provider)` y `fromEnv()` leyendo `LLM_PROVIDER`); un proveedor desconocido lanzará un error que liste los válidos.
5. Escribir los tests unitarios del factory: `OpenAI` → adaptador OpenAI, `Local` → adaptador local, desconocido → error.
6. Escribir el smoke test de integración (opt-in): enviar «Hola, dime hola» contra el LLM real y comprobar que responde; se salta si faltan credenciales.

**Criterios de aceptación**

- [X] Con `LlmProvider.OpenAI`, el factory crea un adaptador de OpenAI
- [X] Con `LlmProvider.Local`, el factory crea un adaptador local (LM Studio)
- [X] Con un proveedor desconocido, el factory lanza un error claro que lista los válidos
- [X] La config se resuelve desde el entorno (`LLM_PROVIDER`, `OPENAI_*`, `LMSTUDIO_*`); `LLM_TEMPERATURE` vacía no se envía al modelo (la familia gpt-5 solo acepta el valor por defecto)
- [X] *Smoke test*: con el proveedor activo, enviar «Hola, dime hola» devuelve una respuesta de texto no vacía
- [X] El *smoke test* es opt-in y se salta si faltan credenciales, para que `npm test` quede siempre verde y offline

```bash
cd backend && npm test              # unitarios del factory (sin red)
cd backend && npm run test:integration   # smoke test contra el LLM real (opt-in)
```

---

### SPEC-00C — CLI inicial: punto de entrada, selección de proveedor y primera conversación

**Objetivo.** Quiero una primera interfaz de consola, agradable y con color, que me deje arrancar la aplicación, elegir con qué LLM hablar y hacerle una pregunta. Es el primer hito visible de extremo a extremo: del menú al modelo y vuelta. La versión completa (CLI integrado con todo el pipeline de agentes y la aprobación humana) queda para SPEC-09; aquí solo monto el esqueleto y la primera conversación directa con el modelo.

**Contrato.** El punto de entrada arranca un flujo interactivo: muestra una cabecera, ofrece un menú principal y, si elijo conversar, me deja escoger proveedor (OpenAI o LM Studio) y escribir preguntas que se envían al modelo a través de `ChatModelFactory` e `IChatModel`. No expongo un puerto nuevo: el CLI es la capa más externa (composición), reutiliza lo construido en SPEC-00B y muestra las respuestas por consola.

**Pasos**

1. Añadir las dependencias de presentación: `@inquirer/prompts` (menús y captura de texto), `boxen` (cabecera en caja) y `chalk` (color).
2. Crear el punto de entrada de la aplicación (`npm start`), que cargue las variables de entorno y lance el flujo del CLI.
3. Mostrar al arrancar una cabecera «GraphSQL Agent» dentro de un recuadro con color.
4. Mostrar un menú principal donde pueda elegir entre iniciar una conversación o salir.
5. Si elijo iniciar conversación, mostrar un submenú para escoger el proveedor: OpenAI o LM Studio (que mapea al proveedor local).
6. Crear el modelo del proveedor elegido con `ChatModelFactory` y entrar en un bucle: pedirme una pregunta, enviarla con `chat()` y mostrar la respuesta con formato y color.
7. Manejar con elegancia que el proveedor no responda (LM Studio apagado, sin red…): los adaptadores fallarán rápido (pocos reintentos) y el CLI mostrará un mensaje claro, dejándome reintentar sin que la app se caiga.
8. Permitir salir del bucle de conversación y del menú de forma limpia (incluido Ctrl+C).

**Criterios de aceptación**

- [X] Al ejecutar `npm start`, aparece la cabecera «GraphSQL Agent» en un recuadro con color
- [X] El menú principal permite iniciar una conversación o salir
- [X] Al iniciar conversación, puedo elegir entre OpenAI y LM Studio
- [X] Tras elegir proveedor, puedo escribir una pregunta y recibo por consola la respuesta del modelo
- [X] Si el proveedor no está disponible, veo un mensaje de error claro (rápido, sin esperas largas) y puedo reintentar sin que la app se caiga
- [X] Puedo encadenar varias preguntas y salir cuando quiera sin que la app se rompa

```bash
cd backend && npm start
```

---

### SPEC-01 — Primer grafo LangGraph: conversar y completar acciones

**Objetivo.** Antes de montar los agentes especializados quiero validar el esqueleto de orquestación: un primer grafo de LangGraph.js capaz de mantener una conversación con estado y de **completar acciones** llamando a herramientas (tools). Es la prueba de que LangGraph hace lo que necesito (nodos, edges condicionales, estado por hilo) antes de invertir en el pipeline real.

**Contrato.** Un grafo compilado que, dado un mensaje del usuario y el identificador de un hilo, decide si responder directamente o invocar una tool, la ejecuta si hace falta y devuelve la respuesta final; conserva el historial de la conversación por hilo mediante un checkpointer. Para esta validación incluyo una tool de demostración (comprobar el estado del sistema). El grafo usa el modelo LangChain por debajo —que sí admite tool-calling y mensajes con estado—, no el puerto `IChatModel`. `IChatModel` queda como abstracción de chat sin tools (hoy solo la ejercita su smoke test); el CLI ya conversa a través del grafo.

**Pasos**

1. Añadir `@langchain/langgraph` (y `zod` para describir las tools).
2. Definir el estado del grafo: la lista de mensajes que se va acumulando turno a turno.
3. Exponer el modelo LangChain del proveedor elegido (reutilizando la selección OpenAI/LM Studio ya construida en SPEC-00B) para poder asociarle tools.
4. Crear una tool de demostración (comprobar el estado del sistema) que el agente pueda invocar.
5. Construir el grafo: un nodo de agente (modelo + tools) y un nodo de tools, con un edge condicional que enrute a la tool cuando el modelo la pida y vuelva al agente; compilarlo con un checkpointer en memoria para mantener el estado por hilo.
6. Integrar el grafo en el CLI: la conversación pasa por el grafo (un hilo por sesión), de modo que pueda conversar y ver cómo completa acciones.
7. Cubrirlo con un test (opt-in) que invoque el grafo con una pregunta que dispare la tool y compruebe que completa y responde.

**Criterios de aceptación**

- [X] El grafo mantiene el contexto de la conversación dentro de un mismo hilo (checkpointer)
- [X] Cuando la pregunta lo requiere, el agente invoca la tool de demostración y usa su resultado en la respuesta
- [X] Desde el CLI puedo conversar a través del grafo y ver la respuesta
- [X] Un test opt-in invoca el grafo, dispara la tool y verifica que responde

```bash
cd backend && npm start                  # conversar a través del grafo
cd backend && npm run test:integration   # incluye el test del grafo (opt-in)
```

---

### SPEC-02 — Ingesta del esquema: BD objetivo → nodos Neo4j

**Objetivo.** Quiero conectarme a la base de datos que me dé el cliente —definida en el `.env` por `TARGET_DB_TYPE` (p. ej. `postgresql`) y `TARGET_DB_NAME`—, extraer su esquema (tablas, columnas, claves primarias y foráneas) y volcarlo a Neo4j como grafo de conocimiento. Después expongo ese escaneo+ingesta como tool(s) para que un agente pueda dispararlo. Es el primer ladrillo del GraphRAG. La vectorización en pgvector la dejo para SPEC-03, donde está la recuperación que la usa.

**Contrato.**

- *Lectura del esquema*: dado el tipo y el nombre de la BD objetivo más las credenciales del `.env`, obtengo la lista de tablas; de cada una, sus columnas (nombre, tipo, si admite nulos), sus claves primarias y sus claves foráneas (columna → tabla y columna referenciadas). En SPEC-02 implemento el lector de PostgreSQL; la estructura queda preparada para añadir otros tipos.
- *Volcado a Neo4j*: por cada tabla creo un nodo `Table` (nombre, nombre completo, esquema, claves primarias, nº de columnas) y un nodo `Column` por columna (nombre, tipo, nullable, si es clave primaria), unidos con la relación `HAS_COLUMN`; por cada clave foránea creo una relación `REFERENCES` entre las tablas. Aseguro `Table.name` único y limpio el grafo de esquema antes de reimportar.
- *Tools para el agente*: una tool que escanea la BD objetivo e ingiere el esquema en Neo4j devolviendo un resumen (nº de tablas, columnas y relaciones), y otra que devuelve el resumen del esquema ya ingerido.
- *Catálogo de BDs objetivo*: cargo de la configuración un mapa de las BDs disponibles (tipo + nombre) para mostrarlo en el CLI y que el cliente elija cuál escanear. Por ahora tiene una entrada (la del `.env`: `postgresql` / `arcadia`), extensible.

**Pasos**

1. Añadir el driver oficial `neo4j-driver`.
2. Definir en el dominio el modelo del esquema: una tabla con sus columnas, claves primarias y claves foráneas.
3. Leer del `.env` la configuración de la BD objetivo (`TARGET_DB_TYPE`, `TARGET_DB_NAME`, host, puerto, usuario, contraseña, esquema) y exponer un catálogo (mapa tipo+nombre) de BDs disponibles para el CLI.
4. Implementar el lector de esquema para PostgreSQL (consultando `information_schema` / `pg_catalog`): tablas, columnas, claves primarias y foráneas.
5. Implementar la conexión a Neo4j y el gestor del grafo de esquema: constraints/índices, nodos `Table` y `Column`, relaciones `HAS_COLUMN` y `REFERENCES`, y limpieza previa.
6. Exponer las tools al agente —«escanear e ingerir esquema» y «resumen del esquema»— y añadirlas al grafo de SPEC-01.
7. En el CLI: una opción para elegir la BD objetivo (mostrando tipo + nombre del catálogo) y lanzar el escaneo e ingesta.
8. Escribir los tests: (a) Neo4j responde, (b) se obtiene el esquema de Arcadia con las tablas esperadas, (c) una tabla queda convertida en su nodo de Neo4j con sus columnas.

**Criterios de aceptación**

- [X] Conecto a la BD objetivo según `TARGET_DB_TYPE` + `TARGET_DB_NAME` del `.env` y extraigo su esquema (tablas, columnas, claves primarias y foráneas)
- [X] El CLI muestra el catálogo de BDs objetivo (tipo + nombre) y puedo elegir cuál escanear
- [X] Tras ingerir, en Neo4j existen los nodos `Table` y `Column` y las relaciones `HAS_COLUMN` y `REFERENCES`
- [X] El agente dispone de una tool para escanear e ingerir el esquema y otra para ver el resumen
- [X] Tests: (a) Neo4j responde; (b) se obtiene el esquema de Arcadia con las tablas esperadas; (c) una tabla queda convertida en su nodo de Neo4j con sus columnas

```bash
cd backend && npm run test:diagnostic   # tests de esquema y de Neo4j (requiere docker up)
```

---

### SPEC-03 — Vectorización del esquema (embeddings → pgvector)

**Objetivo.** Quiero poder encontrar las tablas relevantes para una pregunta aunque el usuario no use los nombres exactos del esquema (pregunta "clientes" → tabla `customer`; pregunta en español sobre esquema en inglés). Para eso vectorizo cada tabla con un modelo de embeddings y guardo el vector en pgvector, listo para la búsqueda semántica que hará el Schema Agent (SPEC-04). El razonamiento de fondo está en [`docs/investigacion/embeddings.md`](../investigacion/embeddings.md).

**Contrato.**

- *Puerto de embeddings*: una forma de convertir texto en vector, sin que el resto sepa si por debajo hay OpenAI o un modelo local. El **proveedor se elige al escanear** (igual que el chat pregunta el suyo); el modelo y la dimensión van **por proveedor** en config (`OPENAI_EMBEDDING_*`, `LMSTUDIO_EMBEDDING_*`). Como LM Studio expone embeddings por el endpoint OpenAI-compatible, un único adaptador parametrizado por `baseURL` cubre ambos (mismo patrón que `IChatModel`).
- *Principio innegociable*: indexo y consulto con el **mismo modelo**; guardo el **modelo y la dimensión junto a cada vector** para detectar mezclas. La columna pgvector tiene dimensión configurable.
- *Almacenamiento*: por cada tabla guardo en pgvector su texto de búsqueda (nombre + columnas, y descripción si la hay), el vector, el **proveedor, el modelo y la dimensión** usados, y la **descripción cruda en su propia columna** (para poder buscarla o mostrarla por texto, no solo por similitud). Guardar el proveedor permite que el retriever (SPEC-04) reconstruya el mismo modelo al consultar.
- *Vectorización integrada en el escaneo, pero confirmada*: al escanear, tras volcar a Neo4j, vectorizo a pgvector **solo tras un aviso explícito** — en rojo el coste si el proveedor es OpenAI, y el tiempo estimado en cualquier caso. Si el modelo activo no coincide con el indexado, aviso y pido re-vectorización explícita (nunca automática).
- *Descripciones opcionales*: si hay en la carpeta `descriptions/` un fichero JSON con un array de objetos `{ tableName, description }`, pregunto una vez si incluirlas; si digo que sí, quedan **sincronizadas en ambos sitios** — el atributo `description` del nodo `Table` en Neo4j y la columna/embedding en pgvector —; si digo que no (o no hay fichero), se ignoran. Dejo un `descriptions.example.json` como guía del formato, que la detección ignora.

**Pasos**

1. Definir el puerto `IEmbeddings` (texto → vector) y la configuración de embeddings **por proveedor** (`OPENAI_EMBEDDING_MODEL`/`DIMENSIONS`, `LMSTUDIO_EMBEDDING_MODEL`/`DIMENSIONS`) en `.env`/`.env.example`. El CLI pregunta el proveedor al escanear, igual que el chat.
2. Implementar el factory + adaptador OpenAI-compatible (OpenAI y local por `baseURL`), espejo de `ChatModelFactory`.
3. Crear el almacén pgvector: tabla de embeddings (texto de búsqueda, `embedding vector(N)`, modelo, dimensión, metadata), extensión `vector` e índice de similitud coseno; dimensión configurable.
4. Componer el texto a embeber por tabla: nombre + columnas, y la descripción si está disponible.
5. Integrar la vectorización en el escaneo: detectar fichero de descripciones en `descriptions/` (ignorando el `.example.json`) y preguntar si incluirlas; avisar del coste (rojo si OpenAI) y del tiempo estimado; confirmar; vectorizar y guardar con modelo/dimensión.
6. Detectar mismatch de modelo/dimensión y pedir re-vectorización explícita con el mismo aviso.
7. Preflight en local: en modo local hay que tener cargados a la vez el modelo de chat y el de embeddings en LM Studio; antes de usar uno, consulto `/v1/models` y aviso claro si no está cargado.
8. Tests: (a) el factory crea el adaptador correcto según el proveedor; (b) integración opt-in: vectorizar Arcadia deja un vector por tabla en pgvector, con el modelo y la dimensión correctos.

**Criterios de aceptación**

- [X] `IEmbeddings` + factory crea un adaptador OpenAI o local según el proveedor elegido (en el CLI, o `EMBEDDING_PROVIDER` por defecto)
- [X] Vectorizar el esquema guarda en pgvector un vector por tabla, con su proveedor, modelo y dimensión
- [X] Antes de vectorizar, el CLI avisa (coste en rojo si OpenAI, tiempo estimado) y pide confirmación
- [X] Si hay un fichero JSON de descripciones en `descriptions/` (el `.example.json` no cuenta), el CLI pregunta si incluirlas — y se guardan en Neo4j y en pgvector
- [X] Si el modelo activo no coincide con el indexado, aviso y pido re-vectorización explícita (no automática)
- [X] En local, si el modelo (chat o embeddings) no está cargado en LM Studio, aviso claro antes de usarlo
- [X] Tests: (a) factory de embeddings (unit, sin red); (b) integración opt-in que vectoriza Arcadia y comprueba las filas en pgvector

```bash
cd backend && npm test                   # unit del factory de embeddings
cd backend && npm run test:integration   # vectorización real contra pgvector (opt-in)
```

**Resultados (hallazgos no contemplados al redactar la spec)**

- **Validado en ambos proveedores**: OpenAI (`text-embedding-3-small`, 1536) y local (`text-embedding-bge-m3` en LM Studio, 256) — 16 tablas de Arcadia vectorizadas en pgvector.
- **bge-m3 en LM Studio devuelve 256 dimensiones, no las 1024 nativas.** Por eso la dimensión es **configurable por proveedor** y se guarda junto a cada vector. 256 funciona; 1024 daría mejor calidad de recuperación (queda como mejora si LM Studio puede servirlo a su dimensión completa).
- **El proveedor de embeddings se elige al escanear** (igual que el chat), no solo por `.env`. La config de modelo/dimensión es **por proveedor** (`OPENAI_EMBEDDING_*`, `LMSTUDIO_EMBEDDING_*`); `EMBEDDING_PROVIDER` queda como default no interactivo.
- **Descripciones sincronizadas** en Neo4j (atributo `description` del `Table`) y en pgvector (columna `description` + texto embebido), a partir de una sola pregunta.
- **Re-vectorización = reconstrucción completa** (drop + recreate), siempre explícita y con aviso; nunca automática.
- **Chat y embeddings son independientes**: el modelo de chat solo consume el contexto del esquema como texto, así que es indiferente al proveedor de embeddings. El acoplamiento real (mismo modelo para indexar y consultar) vive dentro del retriever/vectorizador. Preflight en local para avisar si falta algún modelo cargado.


