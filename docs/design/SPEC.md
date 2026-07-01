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
| D-05 | Todo recurso externo (BD objetivo, LLM, embeddings, store): puerto `I…` + adaptador(es) + **factory** | Generaliza el patrón de D-02/D-03 a todos los recursos. El factory es el único sitio que conoce los adaptadores concretos y elige según configuración; los casos de uso dependen solo del puerto (inyección de dependencias) → testeables con dobles, sin clientes hardcodeados ni discriminar el tipo de motor en la capa de aplicación | ✅ Cerrada |
| D-06 | Recuperación GraphRAG: búsqueda exacta por coseno (sin índice ANN), consultar con el **mismo modelo/dimensión** con que se indexó, y rechazar vectores degenerados | A escala de un esquema (cientos de tablas) el seqscan por coseno es exacto e instantáneo; un índice ANN (ivfflat) con pocas filas devolvía listas vacías. Comparar vectores de espacios distintos no tiene sentido → se reconstruye el modelo del índice, no el del `.env`. El guard (rechazar ceros o dimensión incorrecta) evita indexar/consultar con embeddings rotos sin enterarse | ✅ Cerrada |
| D-07 | Judge por capas: solo las comprobaciones **deterministas** (seguridad sin LLM + sintaxis real vía dry-run contra la BD) invalidan una consulta; el juez LLM es **asesor** (aporta confianza/avisos, no bloquea por sí solo) | El LLM-as-judge da falsos positivos (demasiado estricto); si bloqueara, tumbaría consultas válidas. La BD (dry-run) es la autoridad objetiva de la sintaxis y la seguridad es determinista. El umbral de confianza queda como palanca opcional del operador, separada de la opinión del LLM | ✅ Cerrada |
| D-08 | Pipeline NL→SQL como grafo propio (distinto del conversacional), con la revisión humana como `interrupt_before` y checkpointer en PostgreSQL; el bucle de fijar/modificar lo controla el humano, no el LLM | El flujo determinista (recuperar→SQL→Judge→revisión→ejecutar) no encaja en el grafo de chat con tools de SPEC-01: quiero enrutado por reglas sobre el estado, no decidido por el modelo. `interrupt_before` + checkpointer Postgres dan la pausa recuperable por `thread_id` (una consulta no se ejecuta sin visto bueno). El *must-include* es UX determinista: el humano fija tablas y el grafo rehace la recuperación, sin depender de que el LLM acierte. El reintento automático Judge↔SQL con cuenta de intentos se deja para el supervisor (SPEC-10); aquí el pipeline es el esqueleto que ese supervisor formalizará | ✅ Cerrada |

### 3.1 Patrón obligatorio: acceso a recursos externos (puerto + adaptador + factory)

Todo acceso a un recurso externo (BD objetivo, LLM, embeddings, store de vectores…) sigue **siempre** este patrón. Es la forma de respetar Clean Architecture y de no acabar con clientes hardcodeados ni `if (tipo === …)` repartidos por los casos de uso. Si tengo que añadir un recurso o un nuevo proveedor/motor, estos son los pasos:

1. **Puerto** en `domain/ports/I<Recurso>.ts`: solo los métodos que necesitan los casos de uso. Si el recurso es una conexión con ciclo de vida, incluye `close()`. El dominio no conoce ningún driver.
2. **Adaptador(es)** en `infrastructure/<recurso>/<Proveedor><Recurso>.ts` (PascalCase, uno por clase): implementa el puerto para un proveedor/motor concreto (p. ej. `PostgresTargetDatabase`).
3. **Factory** en `infrastructure/<recurso>/<Recurso>Factory.ts`: el **único** sitio que importa adaptadores concretos. Elige cuál instanciar según la configuración (`switch` por tipo/proveedor) y devuelve el **puerto** ya listo. Ejemplos: `ChatModelFactory`, `EmbeddingsFactory`, `TargetDatabaseFactory`, `SchemaReaderFactory`. Si una operación es específica del motor (p. ej. el dry-run de sintaxis), va como método del puerto y la implementa cada adaptador, no el caso de uso.
4. **Casos de uso**: reciben el puerto por **inyección de dependencias** (objeto de `deps` con un default real que llama al factory). **Nunca** importan adaptadores concretos ni discriminan el tipo de motor; solo dependen de la abstracción.
5. **Tests**: doblo el puerto (o la función del factory que lo devuelve) → unitarios offline, sin Docker ni red.

> **Anti-patrón a evitar:** construir el cliente a mano (`new PostgresX(...)`) o decidir el motor (`if (target.type !== 'postgresql')`) dentro de un caso de uso. Si eso aparece en la capa de aplicación, va al factory. Lo aprendí rehaciendo `executeQuery`/`checkSqlSyntax`/`readTargetSchema`, que repetían ese hardcode hasta que lo centralicé en `TargetDatabaseFactory`.

## 4. Especificaciones de componentes


| ID | Componente | Estado |
|----|-----------|--------|
| SPEC-00 | Infraestructura: BD objetivo (puerto + adaptador Postgres) | ✅ Cerrada |
| SPEC-00B | Infraestructura: proveedor LLM (puerto `IChatModel` + factory) | ✅ Cerrada |
| SPEC-00C | CLI inicial: punto de entrada, selección de proveedor y primera conversación | ✅ Cerrada |
| SPEC-01 | Primer grafo LangGraph: conversar y completar acciones (un nodo + una tool + checkpointer) | ✅ Cerrada |
| SPEC-02 | Ingesta del esquema: conectar a la BD objetivo, extraer su esquema y volcarlo a nodos Neo4j; tools para el agente | ✅ Cerrada |
| SPEC-03 | Vectorización del esquema: puerto `IEmbeddings` (OpenAI/local) + almacenamiento en pgvector + vectorizar al escanear | ✅ Cerrada |
| SPEC-04 | Schema Agent: recuperación (búsqueda semántica + expansión por FKs en el grafo) + tool de schema-linking | ✅ Cerrada |
| SPEC-05 | SQL Agent (NL→SQL con el esquema recuperado) | ✅ Cerrada |
| SPEC-06 | Judge Agent (seguridad: allowlist + EXPLAIN + juez LLM) | ✅ Cerrada |
| SPEC-07 | Execute SQL (solo lectura) | ✅ Cerrada |
| SPEC-08 | Human Review (interrupt) integrado en el pipeline | ✅ Cerrada |
| SPEC-09 | Memory Agent / Store Feedback (opcional, primero en recortar) | ⏳ Pendiente |
| SPEC-10 | Supervisor (enrutador determinista) — al final, una vez existen las piezas | ⏳ Pendiente |
| SPEC-11 | Integración CLI completa + Evaluación experimental (ablation sobre el golden set) | ⏳ Pendiente |
| SPEC-12 | Gestión de conversaciones: nombrar, listar y reanudar hilos | ⏳ Pendiente |
| SPEC-13 | Explicabilidad de la recuperación (traza del GraphRAG) + modo depuración en el CLI | ✅ Cerrada |
| SPEC-14 | El Judge evalúa la certeza del propósito de las tablas usadas (documentada / evidente / supuesta) | ✅ Cerrada |

> **Caso para evaluar las descripciones (hecho en SPEC-04, queda cuantificar en SPEC-11).** Para comprobar que las descripciones aportan de verdad, Arcadia incluye `t_042`, una tabla con **nombre opaco** (no delata que guarda las listas de deseos) y una pregunta del golden set que la necesita (G-25). En SPEC-04 ya validé a mano que con descripciones se recupera y sin ellas no. Lo que queda para SPEC-11 es **medirlo sobre todo el golden set** (con/sin descripciones, además de con/sin grafo). El porqué, en [arquitectura.md §9](arquitectura.md).

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

---

### SPEC-04 — Schema Agent: recuperación de tablas relevantes (GraphRAG)

**Objetivo.** Quiero que, dada una pregunta en lenguaje natural, el sistema encuentre las tablas que hacen falta para responderla — aunque no use los nombres exactos del esquema ("clientes" → `customer`), aunque la pregunta vaya en español y el esquema en inglés, y aunque algún nombre de tabla no diga qué guarda (ahí entran las descripciones). Es el corazón del proyecto: la recuperación GraphRAG que luego alimentará al SQL Agent. Combino dos cosas que ya tengo a medias: buscar tablas candidatas por significado (vectores en pgvector, SPEC-03) y, desde esas candidatas, traer las tablas relacionadas siguiendo las claves foráneas en el grafo (Neo4j, SPEC-02) — porque para un JOIN suelen hacer falta tablas que la pregunta ni menciona.

**Contrato.** Dada una pregunta (texto), devuelvo un contexto de esquema: la lista de tablas relevantes con sus columnas, claves primarias y foráneas, y un texto tipo DDL listo para meter en el prompt del SQL Agent. El contexto deja claro qué tablas elegí, porque lo necesitaré para medir el *schema-linking recall* en la evaluación.

Cómo lo construyo, en dos pasos. Primero embebo la pregunta y busco en pgvector las tablas más parecidas por coseno: las candidatas, hasta un tope configurable (`SEMANTIC_TOP_K`). Después, en Neo4j, expando esas candidatas siguiendo las relaciones `REFERENCES` (en ambos sentidos, un salto) para incluir las tablas vecinas que harían falta en los JOIN. Acoto el conjunto final a un máximo de tablas (`MAX_CONTEXT_TABLES`), re-ordenando por similitud, para que una tabla muy conectada (como `customer`) no arrastre medio esquema; ese tope y `SEMANTIC_TOP_K` son las palancas de precisión del ablation. Con el conjunto resultante, leo del grafo las columnas y claves de cada tabla y compongo el contexto.

Hay un punto innegociable que viene de SPEC-03: consulto con el **mismo modelo de embeddings con el que indexé**. Para eso leo del índice el proveedor, el modelo y la dimensión que guardé y reconstruyo ese mismo modelo, no el del `.env`. Si ese modelo no está disponible (por ejemplo, en local no está cargado en LM Studio), aviso claro y no consulto con otro: comparar vectores de espacios distintos no tiene sentido.

Lo expongo de dos formas, igual que la ingesta y la vectorización: como caso de uso (recibe la pregunta y sus colaboradores inyectados, con implementación real por defecto, para poder probarlo con dobles) y como *tool* del agente, para preguntarle desde el chat "¿qué tablas usarías para …?".

**Pasos**

1. En el dominio, definir el **contexto de esquema**: las tablas relevantes elegidas (reutilizo `TableSchema` para cada una) y una función que las renderiza a un texto tipo DDL (solo esas tablas, con sus columnas y FKs). Expone también la lista de nombres elegidos, para la evaluación.
2. **Búsqueda semántica**: añadir al puerto del almacén (`IEmbeddingsStore`) y a su adaptador de pgvector una búsqueda por similitud — dado un vector, las N tablas más parecidas por coseno usando el índice que ya creé — que devuelva el nombre de la tabla y su score.
3. **Reconstruir el modelo indexado**: a partir del proveedor/modelo/dimensión guardados en el índice (`getIndexedModel`, SPEC-03), construir el mismo adaptador de embeddings, sin leer del `.env`. Preflight en local: avisar si ese modelo no está cargado, igual que al escanear.
4. **Expansión por FK**: añadir al grafo (Neo4j) una lectura que, dadas unas tablas candidatas, devuelva esas tablas más sus vecinas por `REFERENCES` (un salto, ambos sentidos), cada una con sus columnas, claves primarias y foráneas (como `TableSchema`).
5. **Caso de uso de recuperación**: embeber la pregunta → candidatas (pgvector) → expandir (Neo4j) → componer el contexto. Con dependencias inyectadas y defaults reales, siguiendo el patrón de la ingesta y la vectorización, para testearlo con dobles sin levantar Docker.
6. **Constantes nombradas**: el tope de candidatas (`SEMANTIC_TOP_K`) y la profundidad de expansión (un salto, de momento).
7. **Tool de schema-linking**: una tool que, dada una pregunta, devuelva qué tablas elegiría (un resumen del contexto). Añadirla al grafo de SPEC-01.
8. *(Opcional, CLI)* una forma de probar la recuperación desde el chat: preguntar y ver qué tablas saldrían.
9. **Tests**: unit con dobles (el mapeo multilingüe, la expansión por FK, que el contexto trae solo las tablas relevantes, que una tabla se recupera por su descripción aunque el nombre no encaje, y el aviso si el modelo no coincide); integración opt-in que recupera sobre Arcadia de verdad.

**Criterios de aceptación**

- [X] Dada la pregunta "clientes", entre las candidatas aparece `customer` (mapeo multilingüe español→inglés)
- [X] Dadas unas candidatas con FKs, el contexto incluye las tablas relacionadas necesarias para los JOIN (expansión por el grafo)
- [X] El contexto trae **solo las tablas relevantes** (con sus columnas y FKs) y un texto DDL con esas mismas tablas, no el esquema entero
- [X] El caso de uso expone **qué tablas eligió** (para medir el schema-linking recall en SPEC-11)
- [X] La consulta usa el **mismo modelo y dimensión que el índice**; si no coincide o no está disponible, avisa y no consulta con otro
- [X] Una tabla se puede recuperar **por su descripción**, no solo por su nombre (validado con `t_042`)
- [X] Si todavía no hay índice vectorizado, la recuperación avisa de que primero hay que escanear y vectorizar
- [X] El agente dispone de una **tool de schema-linking** que, dada una pregunta, dice qué tablas usaría
- [X] Tests: (a) unit con dobles para el mapeo multilingüe, la expansión por FK y "solo tablas relevantes"; (b) integración opt-in que recupera sobre Arcadia real
- [X] *(Validado a mano)* Con vs sin descripciones sobre `t_042`: **con** descripciones la recupera para "wishlist"; **sin** ellas el sistema responde que no hay tabla de wishlist y no la encuentra. La cuantificación sobre todo el golden set queda para el ablation (SPEC-11)

**Antes de implementar — dataset.** Para que el criterio de las descripciones tenga algo que demostrar, primero añado a Arcadia una tabla con **nombre opaco** (que no delate qué guarda) — por ejemplo, una lista de deseos cliente↔juego —, con sus claves foráneas, su descripción en `descriptions/` y una pregunta en el golden set que la necesite. Toca el esquema (`schema.sql` y su copia `02-schema.sql`), el seed (`seedData.ts` + regenerar `03-dataset.sql` con `pg_dump`), el golden set y el test de diagnóstico (de 16 a 17 tablas), y requiere recargar Docker (`down -v && up`).

```bash
cd backend && npm test                   # unit de la recuperación (con dobles)
cd backend && npm run test:integration   # recuperación real sobre Arcadia (opt-in)
```

---

### SPEC-05 — SQL Agent (NL→SQL con el esquema recuperado)

**Objetivo.** Quiero que, dada una pregunta y el contexto de tablas que recupera el Schema Agent (SPEC-04), el sistema genere la consulta SQL que la responde. Es el paso que convierte "qué tablas" en "qué consulta". De momento me centro en generar la SQL a partir de la pregunta + el contexto; el bucle de reintento con los errores del Judge llega cuando existan el Judge (SPEC-06) y el supervisor (SPEC-10).

**Contrato.** Dada la pregunta (texto) y el contexto de esquema (el DDL de las tablas relevantes, de SPEC-04), devuelvo una sentencia SQL de solo lectura **con su dialecto** (`{ text, dialect }`; empieza por `SELECT` o `WITH`). El **dialecto sale del motor de la BD objetivo** (PostgreSQL, SQL Server…) y lo **inyecto como variable en el prompt**, para que la SQL salga en la sintaxis correcta. Para generarla uso un LLM a través del puerto `IChatModel` —el que monté en SPEC-00B y que hasta ahora solo ejercía el smoke test—: le paso un mensaje de sistema con las reglas estrictas y un mensaje de usuario con el DDL y la pregunta, y me devuelve el texto de la SQL, que limpio (quito las vallas ```` ```sql ```` y los espacios) antes de devolverlo. El caso de uso recibe el `IChatModel` inyectado (con el real por defecto, vía `ChatModelFactory`), para poder probarlo con un doble sin llamar al modelo.

Reglas del prompt (van en el mensaje de sistema y se comprueban por comportamiento): usar exactamente los nombres de tablas y columnas del DDL; no traducir identificadores (la pregunta va en español, el esquema en inglés); solo lectura (`SELECT`/`WITH`, nunca escritura); `GROUP BY` coherente con lo que se agrega; poner `LIMIT` cuando la pregunta pida un "top N"; y, si la pregunta no se puede responder con las tablas dadas, decirlo en vez de inventar columnas.

**Pasos**

1. Definir el mensaje de sistema con las reglas (constante con nombre).
2. Componer el mensaje de usuario a partir del DDL del contexto y la pregunta.
3. Caso de uso `generateSql(question, schemaContext, deps)` que arma los mensajes, llama a `IChatModel.chat()` y limpia la respuesta. Dependencias inyectadas (el modelo de chat) con el real por defecto.
4. Limpiar la salida del LLM: quitar las vallas de código y los espacios sobrantes, quedarme con la sentencia.
5. Dejarlo listo para el supervisor (SPEC-10) y, si ayuda a probar de extremo a extremo, exponerlo como tool del agente.
6. Tests: unit con `IChatModel` doblado (que el prompt incluye el DDL y la pregunta; que limpia las vallas; que devuelve la sentencia); integración opt-in con el LLM real (una pregunta del golden set sobre Arcadia produce un `SELECT` plausible).

**Criterios de aceptación**

- [X] El prompt que recibe el LLM incluye el DDL del contexto, la pregunta y el **dialecto** del motor (verificado doblando `IChatModel`)
- [X] Si el LLM devuelve la SQL entre vallas de código, la salida viene limpia (sin vallas)
- [X] El caso de uso recibe el `IChatModel` inyectable (real por defecto); los tests usan un doble sin red
- [X] Devuelve `{ text, dialect }` con el dialecto del motor objetivo, inyectado como variable en el prompt
- [X] (Integración) una pregunta del golden set sobre Arcadia produce un `SELECT`/`WITH` plausible con los nombres reales del esquema

```bash
cd backend && npm test                   # unit del SQL Agent (con doble de IChatModel)
cd backend && npm run test:integration   # generación real con el LLM (opt-in)
```

---

### SPEC-06 — Judge Agent (validación de seguridad)

**Objetivo.** Antes de ejecutar nada quiero una barrera que garantice que la SQL es **de solo lectura y segura**. Es la seguridad por diseño: pase lo que pase con el LLM, una consulta peligrosa no debe llegar nunca a la BD. La parte obligatoria es una validación sin LLM (rápida y determinista); por encima, opcionalmente, una revisión más fina.

**Contrato.** Dada una sentencia SQL (y el contexto si hace falta), devuelvo un veredicto: si es válida y, si no, por qué (la lista de problemas). Lo organizo en capas, de más a menos importante:

- **Capa 1 — seguridad, sin LLM (obligatoria).** Un servicio de dominio puro: la sentencia debe empezar por `SELECT` o `WITH`; rechazo palabras peligrosas (`DROP`, `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`, `ALTER`, `GRANT`, como palabra completa y sin distinguir mayúsculas); y detecto patrones de inyección (`;` multi-sentencia, comentarios `--` y `/* */`). Si la Capa 1 dice que no, **no se ejecuta nunca**, diga lo que diga el LLM. Al ser pura, la pruebo a fondo con una tabla de casos (un caso por keyword y por patrón), sin dobles.
- **Capa 2 — sintaxis real contra la BD (opcional).** Le pido a la conexión un dry-run (validar la consulta **sin ejecutarla**); cada adaptador sabe cómo (en PostgreSQL es un `EXPLAIN`, que planifica la consulta y comprueba que tablas/columnas existan). Si valida, la sintaxis es correcta; si la rechaza, devuelvo su error. Es la autoridad **objetiva** sobre si la consulta es válida. La recuperé del juez del proyecto Python (que hacía lo mismo) porque vi un falso positivo del juez LLM. El caso de uso solo depende del puerto (`dryRun`), así que lo pruebo con un doble.
- **Capa 3 — LLM-as-judge (opcional).** A través de `IChatModel`, el LLM revisa la SQL contra el contexto por varios criterios (sintaxis, semántica con nombres reales y JOINs por FK, completitud respecto a la pregunta, seguridad y optimización) y devuelve un veredicto rico: válido o no, **confianza (0..1)**, errores, avisos, sugerencias, tablas verificadas y una explicación. Tomé como referencia el juez del proyecto Python anterior. **El juez LLM no bloquea por sí solo**: sus "errores" los muestro como avisos, porque puede ser demasiado estricto y dar falsos positivos. Quien bloquea es la Capa 1 (seguridad) y la Capa 2 (sintaxis real). Puedo exigir una confianza mínima (`minConfidence`) como palanca del operador. Si su respuesta no es interpretable, lo trato como error de dominio (no rompe el flujo). Inyecto el `IChatModel`.

El veredicto es lo que mira el supervisor (SPEC-10): si no supera el Judge (inválido o por debajo del umbral de confianza) y quedan reintentos, vuelve al SQL Agent con los errores; si se agotan los reintentos, la consulta pasa a la revisión humana marcada como fracasada (no ejecutable); si lo supera, sigue el circuito normal. La política completa, en SPEC-10.

**Pasos**

1. Definir en el dominio el veredicto de validación (válido + errores/avisos; el rico, con confianza/sugerencias, para el juez LLM).
2. Implementar la **Capa 1** como servicio de dominio puro: allowlist `SELECT`/`WITH`, keywords peligrosas (palabra completa), patrones de inyección. Constantes con nombre para las listas.
3. Tests de la Capa 1: tabla parametrizada con un caso por keyword peligrosa y por patrón de inyección, más `SELECT`/CTE legítimos que pasan.
4. Implementar la **Capa 2** (sintaxis): pedir el dry-run a la conexión (`ITargetDatabase.dryRun`); si lanza, inválida con el error de la BD.
5. Implementar la **Capa 3** (LLM-as-judge) como caso de uso con `IChatModel` inyectado; parsear el veredicto y, si no es interpretable, error de dominio que no rompe el flujo.
6. Combinar: bloquean la Capa 1 y la Capa 2; el juez LLM solo aconseja (sus errores pasan a avisos). Dejarlo listo para el bucle del supervisor (reintento SQL↔Judge).

**Criterios de aceptación**

- [X] Una sentencia que no empiece por `SELECT`/`WITH` se marca inválida
- [X] Presencia de `DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|GRANT` (palabra completa) → inválida, con error explícito
- [X] Patrones de inyección (`;` multi-sentencia, `--`, `/* */`) → inválida
- [X] Un `SELECT` legítimo con JOINs y CTE → válida
- [X] Si la Capa 1 rechaza, el resultado lo deja claro y el flujo no llega a ejecutar (invariante de seguridad)
- [X] (Capa 2) `EXPLAIN` contra la BD: si la BD acepta la consulta es válida; si la rechaza, inválida con el error de la BD
- [X] (Capa 3) dado SQL + contexto, devuelve un veredicto; **el juez LLM no bloquea por sí solo** (sus errores pasan a avisos); si responde algo no interpretable, se trata como error de dominio sin romper
- [X] Tests: Capa 1 con tabla parametrizada (pura, sin dobles); Capa 2 con doble de la conexión (`dryRun`); Capa 3 con `IChatModel` doblado

```bash
cd backend && npm test                   # Capa 1 (pura) + Capa 2 y Capa 3 con dobles
```

---

### SPEC-07 — Execute (ejecución segura de solo lectura)

**Objetivo.** Una vez tengo una consulta validada (SPEC-06), quiero ejecutarla de verdad contra la BD objetivo y traer los resultados. Es el paso que convierte la SQL en datos. Lo importante aquí no es solo ejecutar, sino hacerlo **sin poder hacer daño**: solo lectura, con la Capa 1 del Judge como última barrera justo antes de lanzar la consulta, y con topes que eviten que una consulta enorme o lenta tumbe el terminal.

**Contrato.** Dada una sentencia SQL ya validada, la ejecuto en una sesión de solo lectura contra la BD objetivo y devuelvo el resultado: los nombres de las columnas, las filas, cuántas filas devuelve y si se ha truncado por el tope (las columnas salen de las propias filas; si la consulta no devuelve filas, la lista de columnas va vacía). Antes de ejecutar nada, vuelvo a pasar la comprobación de seguridad (`checkSqlSafety`); si dijera que no es de solo lectura, lanzo `UnsafeQueryError` y **no toco la BD**. Es defensa en profundidad: aunque algo se saltara las comprobaciones anteriores, la consulta no llega a ejecutarse. Recibo la conexión a la BD inyectada (real por defecto, vía `TargetDatabaseFactory`), para probar el caso de uso con un doble sin Docker.

**Mecanismo.** La sesión se abre en solo lectura (la abre así el adaptador), de modo que una escritura falla en la propia BD aunque se colara. El tope de filas y el límite de tiempo **no los resuelve el caso de uso**: este pide a la conexión "como mucho N filas, dime si había más" (`fetchCapped`) y el adaptador lo implementa de forma eficiente para su motor (en PostgreSQL, leyendo `tope+1` filas con un cursor, sin traerse todo el resultado); el `statement_timeout` lo fija el adaptador al conectar. La conexión se abre y se cierra por ejecución, como en los demás casos de uso.

**Pasos**

1. Definir en el dominio el resultado de una ejecución (`QueryResult`: columnas, filas, número de filas, si está truncado) y la excepción `UnsafeQueryError`.
2. Implementar el caso de uso `executeQuery`: re-validar la seguridad (si falla → `UnsafeQueryError`, sin tocar la BD), pedir a la conexión la consulta acotada (`fetchCapped`) y mapear el resultado. Tope de filas y `statement_timeout` con constantes con nombre.
3. Dependencias inyectadas: por defecto conecta vía `TargetDatabaseFactory` (con el `statement_timeout`) y cierra al terminar; en tests, un doble de `ITargetDatabase`.
4. Tests unit con doble: mapeo de filas y columnas, que se respeta la marca de truncado del adaptador, y que una SQL no de solo lectura corta con `UnsafeQueryError` **sin** conectar a la BD.
5. Tests de integración opt-in: ejecutar una `SELECT` real sobre Arcadia y comprobar las filas; comprobar que un intento de escritura falla por la sesión de solo lectura.
6. Dejarlo listo para que la Human Review (SPEC-08) lo invoque tras la aprobación.

**Criterios de aceptación**

- [X] Una `SELECT`/CTE válida se ejecuta y devuelve columnas y filas
- [X] Antes de ejecutar se vuelve a pasar la comprobación de seguridad; una sentencia que no sea de solo lectura lanza `UnsafeQueryError` y **no se ejecuta** (última barrera)
- [X] La sesión es de solo lectura: un intento de escritura falla en la BD
- [X] Si la consulta devuelve más filas que el tope, el resultado se marca como truncado
- [X] Una consulta que supera el `statement_timeout` se corta con un error claro
- [X] La conexión se abre y se cierra por ejecución (sin fugas)
- [X] Tests: unit con doble (mapeo, truncado, `UnsafeQueryError` antes de tocar la BD); integración opt-in sobre Arcadia real

```bash
cd backend && npm test                   # unit de la ejecución (con doble)
cd backend && npm run test:integration   # ejecución real sobre Arcadia (opt-in)
```

---

### SPEC-08 — Human Review (aprobación humana, interrupt)

**Objetivo.** Ninguna SQL se ejecuta sin mi visto bueno. Quiero que el flujo se **pare**, me enseñe la consulta generada (y qué tablas ha usado) y recoja mi decisión. Y aprovecho este punto para resolver lo de las **tablas fijadas**: si veo que falta una tabla, poder fijarla y relanzar.

**Contrato.** Cuando el flujo llega a la revisión, se interrumpe y me muestra la SQL propuesta y las tablas del contexto con que se generó. Yo decido entre:

- **Aprobar** → se ejecuta (SPEC-07).
- **Rechazar** → termina, no se ejecuta.
- **Modificar** → edito la SQL a mano y vuelve al Judge a re-validarla.
- **Fijar tabla(s) y relanzar** → indico una o varias tablas que deben entrar sí o sí; el flujo **vuelve a la recuperación con esas tablas fijadas** (`mustInclude`, SPEC-04), regenera el contexto y la SQL, y vuelve a pararse aquí. Es la UX determinista del must-include: el flujo lo controlo yo, no el LLM.

Hay un caso especial: una consulta que **no logró pasar el Judge** tras agotar los reintentos (ver SPEC-10) también llega aquí, pero marcada como **fracasada**. La veo y la puedo evaluar (con el veredicto del Judge a la vista), pero **no se puede aprobar para ejecutar**: las opciones útiles son rechazar, modificarla a mano o fijar tablas y relanzar. Así el humano siempre tiene la última palabra sobre la consulta, sin que se ejecute algo que el Judge no avaló.

**Mecanismo.** El nodo de revisión se compila con `interrupt_before`: LangGraph pausa el grafo y **persiste el estado** (checkpointer en PostgreSQL), recuperable por `thread_id`; al reanudar con mi decisión, sigue por la rama que toque. Las tablas fijadas viven en el estado, así que se conservan entre reintentos.

**Pasos**

1. Añadir al estado del grafo la decisión humana y la lista de tablas fijadas.
2. Compilar el grafo con `interrupt_before` en el nodo de revisión y mover el checkpointer a PostgreSQL (hasta ahora en memoria).
3. En el CLI: presentar el resultado en dos cajas (`boxen`) bien diferenciadas — una con la **consulta SQL** (resaltada) y sus tablas, y otra con la **evaluación del Judge** (color según el veredicto con `chalk`: verde si es válida, rojo si no; la confianza, el porqué, qué le resta confianza y las sugerencias). Aquí la presentación la pinto yo, sin LLM de por medio, así que sí puedo usar color y cajas (a diferencia del chat, donde la salida pasa por el agente y no admite ANSI). Luego ofrecer las cuatro opciones (aprobar / rechazar / modificar / fijar tablas y relanzar).
4. Al reanudar: aprobar → execute; rechazar → fin; modificar → Judge; fijar tablas → recuperación con `mustInclude` y de nuevo SQL → Judge → revisión.
5. Validar las tablas fijadas contra el esquema: si una no existe, avisar e ignorarla (no fijar un fantasma).
6. Tests (integración con checkpointer): que pausa y persiste; que aprobar continúa a execute; que fijar una tabla relanza la recuperación y esa tabla aparece en el contexto nuevo.

**Criterios de aceptación**

- [X] Al llegar a la revisión, el grafo se interrumpe y el estado queda persistido (recuperable por `thread_id`)
- [X] Aprobar → continúa a ejecutar; rechazar → termina sin ejecutar
- [X] Modificar → la SQL editada vuelve al Judge
- [X] Fijar una tabla (p. ej. `t_042`) y relanzar → la recuperación se rehace con esa tabla fijada y aparece en el contexto nuevo
- [X] Una tabla fijada que no existe en el esquema se avisa y se ignora
- [X] La consulta y la evaluación del Judge se muestran en cajas (`boxen`) separadas y con color (`chalk`) según el veredicto
- [X] Tests de integración con checkpointer: pausa/persistencia, reanudar-aprobar, reanudar-fijar-tabla

```bash
cd backend && npm run test:integration   # human review con checkpointer (opt-in)
```

---

### SPEC-10 — Supervisor (enrutador determinista)

**Objetivo.** Unir todas las piezas en un único flujo, enrutado con reglas sobre el estado compartido (no con un LLM): Schema → SQL → Judge → (decisión) → Human Review → Execute. Llega al final, cuando las piezas ya existen.

**Política del bucle Judge ↔ SQL Agent (anotado, se detallará al implementar).** Es el corazón del supervisor:

- **Umbral de aprobación configurable.** El Judge da por buena la consulta solo si es válida y su confianza supera el umbral (`minConfidence`, SPEC-06). Por debajo, cuenta como no superada.
- **Si no supera el Judge → vuelve al SQL Agent.** Se le devuelve la consulta con los errores/avisos del Judge para que la rehaga. Es el reintento SQL↔Judge.
- **Número de intentos configurable.** El estado lleva la cuenta de intentos; cada vuelta al SQL Agent suma uno, hasta un máximo configurable.
- **Si se agotan los intentos sin superarlo → consulta fracasada.** No se da por perdida en silencio: igualmente pasa a la **Human Review (SPEC-08)** marcada como fracasada, para que el humano la vea y la evalúe, pero **no se podrá ejecutar** (solo rechazar, modificar a mano o fijar tablas y relanzar).
- **Si lo supera (dentro de los intentos) → sigue el circuito normal:** Human Review y, tras la aprobación, Execute (SPEC-07).

El umbral y el máximo de intentos son palancas de configuración: suben o bajan lo estricto que es el sistema antes de pedir ayuda al humano.

*(Contrato completo, pasos y criterios de aceptación: se detallarán al abordar el SPEC-10.)*

---

### SPEC-12 — Gestión de conversaciones: nombrar, listar y reanudar hilos

**Objetivo.** Quiero poder ponerle un nombre a la conversación (chat o consulta) que voy a empezar, ver más tarde un listado de las conversaciones guardadas (con su identificador y una descripción) y **retomar** cualquiera donde la dejé. Es gestión de sesiones, no memoria semántica: se apoya en el checkpointer que ya persiste el estado por `thread_id` (SPEC-08), y es cosa distinta del Memory Agent (SPEC-09), que reutiliza consultas pasadas como ejemplos *few-shot*. La descripción puede escribirla el usuario o generarla el modelo (un resumen breve del hilo).

**Contrato.**

- *Nombrar al empezar*: al iniciar una conversación o una consulta, doy (o se autogenera) un **título**; el hilo queda registrado con su `thread_id`, el título, una descripción opcional, el tipo (chat o consulta) y las marcas de tiempo.
- *Registro de conversaciones*: un almacén propio en `graphsql_memory` (tabla aparte de los checkpoints de LangGraph) guarda esos metadatos. El estado del grafo lo sigue guardando el checkpointer; este registro solo añade la capa legible (id + título + descripción + fecha) que el checkpointer no da por sí solo.
- *Listar y reanudar*: el CLI ofrece "reanudar conversación", muestra el listado ordenado por fecha y, al elegir uno, retoma ese `thread_id` con su estado intacto (el historial del chat, o el punto del pipeline en que se pausó).
- *Descripción automática (opcional)*: si no doy título/descripción a mano, un resumen breve vía `IChatModel` describe de qué iba la conversación. Es la única parte con LLM; si falla o no se quiere, el título a mano basta.
- *Mantenimiento*: puedo **renombrar** y **borrar** hilos desde el CLI; borrar un hilo elimina su registro y su checkpoint.
- *Requisito*: para poder reanudar el **chat**, su grafo tiene que usar el checkpointer de PostgreSQL (hoy el conversacional usa `MemorySaver`, efímero); el pipeline (SPEC-08) ya lo usa.

**Pasos**

1. Mover el grafo conversacional (SPEC-01) al checkpointer de PostgreSQL (SPEC-08), para que su estado sobreviva al proceso y sea reanudable.
2. Definir el puerto del registro de conversaciones (crear, listar, obtener, renombrar, borrar) + adaptador Postgres en `graphsql_memory` + factory, siguiendo el patrón puerto/adaptador/factory (D-05). Metadatos: `thread_id`, `title`, `description`, `kind` (chat/consulta), `created_at`, `updated_at`.
3. Al iniciar una conversación o consulta: pedir el título (o dejarlo autogenerar) y registrar el hilo antes de arrancar el grafo.
4. Descripción automática opcional: un caso de uso que resume el hilo con `IChatModel` y actualiza el registro; con `IChatModel` inyectado para probarlo con un doble.
5. CLI: opción "Reanudar conversación" que lista los hilos (id + título + descripción + fecha) y retoma el elegido por su `thread_id`; y acciones de renombrar/borrar.
6. Tests: unit del registro con doble/en memoria (crear, listar, renombrar, borrar) y del resumen con `IChatModel` doblado; integración opt-in que persiste un hilo, lo lista y lo reanuda recuperando el estado.

**Criterios de aceptación**

- [ ] Al empezar, puedo dar un título a la conversación; el hilo queda registrado con su `thread_id`
- [ ] El CLI muestra un listado de conversaciones guardadas (id + título + descripción + fecha)
- [ ] Puedo elegir una del listado y **reanudarla** con su estado intacto (historial del chat o punto del pipeline)
- [ ] La descripción puede escribirla el usuario o autogenerarse con el LLM (resumen breve); si el LLM falla, el título a mano basta
- [ ] Puedo renombrar y borrar hilos; borrar elimina el registro y su checkpoint
- [ ] El grafo conversacional usa el checkpointer de PostgreSQL (reanudable, no efímero)
- [ ] Tests: unit del registro (con doble) y del resumen (con `IChatModel` doblado); integración opt-in que persiste, lista y reanuda un hilo

```bash
cd backend && npm test                   # unit del registro de conversaciones y del resumen
cd backend && npm run test:integration   # persistir/listar/reanudar con checkpointer real (opt-in)
```

---

### SPEC-13 — Explicabilidad de la recuperación (traza del GraphRAG)

**Objetivo.** Quiero ver por dentro cómo decide la recuperación qué tablas entran en el contexto, para no dar por buena "a ciegas" una recuperación que parece semántica pero no lo es. En concreto: qué tablas puntúan alto por significado (con su score coseno), cuáles se eligen como candidatas, cuáles se añaden por expansión de claves foráneas (y con qué score quedan, aunque sea bajo), y cuáles sobreviven al recorte final y por qué. Es transparencia del circuito GraphRAG y, de paso, la base cualitativa del ablation (SPEC-11): sin los scores a la vista, uno cree que una tabla se recuperó por significado cuando en realidad la arrastró el grafo.

**Contrato.** Un caso de uso de "explicar la recuperación" que, dada una pregunta, además del contexto final devuelve una **traza** con:

- *Ranking semántico*: todas las tablas con su score de similitud (coseno), ordenadas.
- *Candidatas*: las top-K por significado (`SEMANTIC_TOP_K`), marcadas sobre el ranking.
- *Expansión por FK*: las tablas que se añaden como vecinas de las candidatas (las que no eran candidatas), cada una con su score semántico —normalmente bajo, que es justo lo que explica que entraran por el grafo y no por el vector—.
- *Contexto final*: las tablas tras acotar a `MAX_CONTEXT_TABLES`, cada una con su score y el **motivo** de inclusión (semántica / expansión / fijada por el humano).
- *Palancas*: los valores de `SEMANTIC_TOP_K` y `MAX_CONTEXT_TABLES` usados.

La traza no cambia la recuperación: es la misma que usa el pipeline, solo que además expone los pasos intermedios. Reutiliza los colaboradores ya inyectables de SPEC-04 (el ranking por similitud y la expansión por FK), así que se prueba con dobles sin tocar pgvector ni Neo4j.

**CLI.** Una opción de menú "Depurar recuperación (ver el circuito)" que pide una pregunta y pinta la traza en tablas legibles (con `chalk`/`boxen`): el ranking semántico resaltando el corte top-K, la lista de expansión con sus scores, y el contexto final con la columna "motivo". Opcional: un modo depuración que muestre esta misma traza durante el pipeline normal (SPEC-08), antes de la revisión, para ver de dónde salió cada tabla de la consulta.

**Pasos**

1. En el dominio, definir la traza de recuperación (ranking con scores, candidatas, expansión con scores, contexto final con score y motivo, y las palancas).
2. Caso de uso `explainSchemaRetrieval(question, deps)` que reaprovecha el ranking y la expansión de SPEC-04 y compone la traza sin alterar el resultado. Dependencias inyectadas (reales por defecto).
3. CLI: opción de menú que pide la pregunta y renderiza la traza (ranking con el corte top-K resaltado, expansión, contexto final con motivo).
4. *(Opcional)* Un flag/modo depuración que imprima la traza también en el pipeline (SPEC-08) antes de la revisión.
5. Tests: unit con dobles (que el motivo distingue semántica de expansión de fijada; que el score de una tabla que entra por FK es más bajo que el de las candidatas; que el corte top-K y el recorte final se reflejan en la traza).

**Criterios de aceptación**

- [X] Dada una pregunta, obtengo el ranking semántico completo con el score de cada tabla
- [X] La traza distingue las **candidatas** (top-K) de las tablas añadidas por **expansión de FK**, y muestra el score de ambas
- [X] El contexto final indica, por tabla, el **motivo** de inclusión (semántica / expansión / fijada)
- [X] Se ve el efecto de las palancas (`SEMANTIC_TOP_K`, `MAX_CONTEXT_TABLES`) sobre lo que entra y lo que se recorta
- [X] Desde el CLI, una opción de depuración muestra todo esto en tablas legibles para una pregunta dada
- [X] La traza no altera la recuperación (mismo contexto que usa el pipeline)
- [X] Tests unit con dobles: motivo semántica vs expansión vs fijada; score bajo de las expandidas; reflejo del corte top-K y del recorte final

```bash
cd backend && npm test    # unit de la traza de recuperación (con dobles)
cd backend && npm start   # menú → "Depurar recuperación (ver el circuito)"
```

---

### SPEC-14 — El Judge evalúa la certeza del propósito de las tablas usadas

**Objetivo.** Quiero que el Judge no solo valide que la SQL es segura y correcta (SPEC-06), sino que juzgue **si sabe de verdad qué contiene cada tabla que usa**. Una tabla de nombre opaco y sin descripción (como `t_042`) se usa por **suposición**: sus columnas sugieren un vínculo cliente↔juego, pero igual podría ser una wishlist, una lista de bloqueados o "los juegos más odiados". En ese caso el Judge debe **avisar** de que el uso es una conjetura, para que no se dé por sabido algo que en realidad se adivina. Si la tabla tiene descripción (o su nombre/columnas dejan claro el propósito), no hace falta aviso: como mucho, informa del mapeo ("t_042 → 'lista de deseos', según su descripción"). Es hacer del Judge un juez también del **sentido** de la consulta, no solo de su forma. Sigue D-07: son avisos, no bloqueos.

**Contrato.**

- *Prerrequisito — la descripción viaja en el contexto.* Hoy el contexto de esquema (SPEC-04) lleva columnas y claves, pero no la descripción de cada tabla. Para que el Judge (y el SQL Agent) puedan valorar el propósito, incluyo la descripción de cada tabla en su `TableSchema` y la renderizo en el DDL del contexto como comentario (`-- <descripción>`, o marca de "sin descripción" cuando no la haya).
- *Evaluación por tabla usada.* Para cada tabla que aparece en la SQL, el Judge clasifica cómo conoce su propósito:
  - **documentada**: tiene descripción → informa del mapeo (tabla → significado, "según descripción"); sin aviso.
  - **evidente**: sin descripción, pero el nombre y/o las columnas lo dejan claro (p. ej. `customer`, o `game_rating(customer_id, game_id, score)`); sin aviso.
  - **supuesta**: nombre opaco + sin descripción + propósito solo inferible de las columnas → **aviso** de que la tabla se usa por suposición y hay que verificarla.
- *Dónde va.* Los avisos de "supuesta" entran en los `warnings` del veredicto (no bloquean; el juez LLM es asesor) y opcionalmente restan confianza. El mapeo de las documentadas/evidentes va en un campo del veredicto para mostrarlo en la revisión (SPEC-08).
- *Reparto determinista / LLM.* Lo determinista (¿la tabla tiene descripción?) sale de los datos y es lo único que **alimento** al juez; el juicio (¿el nombre/columnas hacen evidente el propósito?, redactar el mapeo o el aviso) es del juez LLM (Capa 3), guiado por el prompt.

**Pasos**

1. Añadir la descripción a `TableSchema` y traerla en la lectura del grafo (`getTablesWithForeignKeyNeighbors`, Neo4j); renderizarla en el DDL del contexto como comentario, marcando también su ausencia.
2. Ampliar `JudgeVerdict` con la evaluación por tabla usada: su propósito y la fuente (descripción / nombre / columnas / supuesto).
3. Ampliar el prompt del juez LLM (Capa 3) para identificar las tablas usadas, clasificar la certeza de su propósito con la evidencia disponible, informar del mapeo de las claras y **avisar** de las supuestas; dejar explícito que el aviso no bloquea.
4. En el CLI (revisión, SPEC-08): mostrar los mapeos y, destacados, los avisos de tablas usadas por suposición.
5. Tests: unit con `IChatModel` doblado — tabla documentada → mapeo sin aviso; tabla de nombre opaco sin descripción → aviso de "suposición"; tabla de nombre/columnas evidentes → sin aviso; y unit de que el DDL del contexto incluye la descripción (o su ausencia).

**Criterios de aceptación**

- [X] El contexto de esquema incluye la descripción de cada tabla (o marca su ausencia) y el Judge la recibe
- [X] Si la SQL usa una tabla **documentada**, el Judge informa del mapeo (tabla → significado, según descripción) sin avisar
- [X] Si usa una tabla de **nombre opaco sin descripción** cuyo propósito solo se infiere, el Judge **avisa** de que se usa por suposición (en `warnings`, sin bloquear)
- [X] Si usa una tabla de **nombre/columnas evidentes** (aunque no tenga descripción), no avisa
- [X] Los avisos y mapeos se ven en la revisión humana (SPEC-08)
- [X] Tests unit con `IChatModel` doblado para los tres casos, y que el DDL del contexto lleva la descripción (o su ausencia)

```bash
cd backend && npm test    # unit del Judge (evaluación de propósito, con doble de IChatModel)
```


