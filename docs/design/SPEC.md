# Especificación de Implementación (SDD) — GraphSQL

> 🌱 **Documento incremental.** SDD aplicado de forma incremental: **cada componente se especifica justo antes de implementarlo** (*spec-first* por slice), no todo de golpe.

## Cómo leer este documento

Es la especificación de ingeniería del proyecto: qué se construye y con qué criterios de aceptación. Es largo a propósito (una entrada por componente); **no hace falta leerlo entero**. Para orientarte:

- **§1 Principios** y **§2 Stack** — la metodología y las tecnologías, en dos pinceladas.
- **§3 Decisiones (D-xx)** — la tabla de decisiones de diseño con su porqué. Si te preguntas "¿por qué está hecho así?", empieza aquí. En §3.1 está el patrón obligatorio de acceso a recursos externos.
- **§4 Especificaciones por componente** — una **tabla-índice** con todos los componentes (SPEC-00…SPEC-25) y su estado (✅ hecho / 🔮 futuro). Debajo, cada componente tiene su ficha con el mismo formato: **Objetivo · Contrato · Pasos · Criterios de aceptación**. Salta directo al que te interese.
- **Mejoras futuras (al final)** — un backlog de una línea por idea, SIN spec. Ahí aparco lo que veo venir pero no voy a implementar todavía; cuando toque, se promociona a SPEC-xx.

¿Buscabas cómo funciona o cómo se usa? El diseño de alto nivel está en [arquitectura.md](arquitectura.md) y el uso en el [README](../../README.md).

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
| D-08 | Pipeline NL→SQL como grafo propio (distinto del conversacional), con la revisión humana como `interrupt_before` y checkpointer en PostgreSQL; el bucle de fijar/modificar lo controla el usuario, no el LLM | El flujo determinista (recuperar→SQL→Judge→revisión→ejecutar) no encaja en el grafo de chat con tools de SPEC-01: quiero enrutado por reglas sobre el estado, no decidido por el modelo. `interrupt_before` + checkpointer Postgres dan la pausa recuperable por `thread_id` (una consulta no se ejecuta sin visto bueno). El *must-include* es UX determinista: el usuario fija tablas y el grafo rehace la recuperación, sin depender de que el LLM acierte. El reintento automático Judge↔SQL con cuenta de intentos se deja para el supervisor (SPEC-10); aquí el pipeline es el esqueleto que ese supervisor formalizará | ✅ Cerrada |
| D-09 | Evaluación por ablation de tres modos (sin recuperación / solo vectorial / GraphRAG) sobre el golden set, midiendo schema-linking recall, tamaño de contexto y execution accuracy (comparando el resultado, no el texto de la SQL) | Aísla la aportación de cada capa de recuperación con una baseline justa (no un ninot de palla). El recall aísla la recuperación de si el LLM acierta; el tamaño de contexto captura el coste que el recall no ve (la baseline "sin recuperación" tiene recall 1 pero contexto enorme); la execution accuracy por comparación de resultado es el estándar (una misma pregunta admite varias SQL equivalentes). Se asume el límite de un golden set pequeño, un dominio y un modelo, y se declara | ✅ Cerrada |
| D-11 | Métrica **complementaria** de equivalencia semántica: un segundo LLM juzga si la SQL candidata responde a la MISMA pregunta que la de referencia (con la candidata ejecutable como precondición); se reporta **al lado** de la execution accuracy, no en su lugar | Comparar el resultado (aun con la variante "justa" de contención) exige un conjunto de filas casi idéntico, y eso infravalora aciertos correctos que difieren en cosas irrelevantes: empates en un top-N, columnas descriptivas de más, agregaciones equivalentes escritas distinto; y la generación LLM no es determinista, así que exigir resultado casi idéntico penaliza de más. Un juez de equivalencia captura esos aciertos. Ahora bien, la equivalencia de consultas es indecidible en general y un LLM-juez también se equivoca (mismo riesgo que el juez de SPEC-06): por eso NO es la métrica titular —esa sigue siendo la execution accuracy objetiva y reproducible— sino una cota superior "semántica" que se reporta junto a ella, con su falibilidad declarada | ✅ Cerrada |
| D-12 | Oculto el chat conversacional del menú del CLI (YAGNI), pero **conservo** el grafo `agentGraph` y sus tools (`schemaTools`, `sqlTools`) sin borrarlos | El pipeline NL→SQL con revisión (SPEC-08/10/15) cubre el caso de uso real; la conversación libre no aportaba y confundía en la demo. No la borro porque el grafo y sus tools son una base reutilizable para direcciones futuras (un servidor MCP, backends específicos): oculto solo el punto de entrada (la opción de menú), reactivable con una línea. Distinto de borrar código muerto: aquí es código vivo y reutilizable, solo no expuesto | ✅ Cerrada |
| D-13 | Golden set: interpretación **inclusiva** de las agregaciones "por/cada categoría" — la SQL de referencia incluye las categorías con 0/NULL (LEFT JOIN), no solo las que tienen actividad | Revisando a mano los fallos vi que varias referencias usaban INNER JOIN y ocultaban categorías sin actividad (regiones sin clientes, géneros sin valoraciones, planes sin suscripciones, plataformas sin sesiones, regiones sin ingresos). Pero una pregunta "por/cada X" pregunta por TODAS las X, y un 0 es información (una región sin ventas es una señal, no una fila a ocultar; el front la etiqueta "sin datos"). Así que la respuesta fiel incluye las vacías, y penalizar al modelo por generarla era un error de la ground truth, no del modelo. Aplico la regla por el ENUNCIADO y de forma uniforme (puede perjudicar a un candidato que usara INNER), no para favorecer al modelo, y mantengo los números anteriores para transparencia. Límite conocido: cualquier referencia única fija una interpretación; para preguntas ambiguas es intrínseco a la execution accuracy (por eso está D-11) | ✅ Cerrada |
| D-14 | Despliegue objetivo **on-premise** (dentro del perímetro de la organización); la entrega se materializa como instalación reproducible con Docker Compose, **sin instancia en nube pública** | GraphSQL se conecta a la BD corporativa y maneja su esquema, sus descripciones y los resultados de las consultas: exactamente el tipo de pieza que una empresa no despliega en una nube de terceros (lo veo en mi propio entorno laboral: las aplicaciones y las bases de datos corren en servidores propios, orquestadas con Kubernetes y Docker, minimizando lo expuesto a la nube). El proveedor LLM local (LM Studio) existe justo para eso: que ni las preguntas ni el esquema salgan del perímetro; publicar una instancia en un VPS iría contra esa decisión de diseño y demostraría el sistema en un entorno donde ningún usuario real lo usaría. Como aplicación CLI cuya infraestructura ya está empaquetada en contenedores, la entrega natural es la instalación documentada y reproducible (`docker compose up` + guía), y ese mismo compose es la base directa de un despliegue productivo en un orquestador (Kubernetes) sobre servidores de la organización — queda como mejora futura junto al servidor MCP | ✅ Cerrada |
| D-15 | Consultas guardadas: **una sola tabla `saved_queries` con flags** (`use_as_example`, `is_favorite`) y **guardado explícito tras ver el resultado**, no automático al aprobar; una columna `user_id` (hoy un valor por defecto) deja la puerta abierta al futuro por-usuario | La memoria *few-shot* (SPEC-09) y las consultas favoritas (SPEC-25) comparten la forma de fila (pregunta, SQL, BD objetivo, tablas, fecha) y el MISMO momento natural de guardado: "he visto el resultado y es bueno". Guardarlo una vez en una tabla con dos flags es más simple que dos tablas duplicadas, evita el `if (tipo)` en la capa de aplicación (un solo puerto/adaptador/factory, D-05) y hace el por-usuario futuro una columna, no una migración doble. Los dos comportamientos quedan separados por flag: la recuperación semántica filtra `use_as_example = true` (+ misma BD + umbral, D-06); la lista de favoritas filtra `is_favorite = true`. Cambio el disparador de SPEC-09 de automático-al-aprobar a **explícito**: aprobar la SQL valida el texto, pero ver el resultado valida la RESPUESTA — es un mejor sello de calidad para un corpus de ejemplos, y evita sembrarlo de consultas exploratorias o casi-duplicadas que ensuciarían los *few-shot*. El coste (un paso más y menos ejemplos) lo asumo a cambio de un corpus que el usuario cura, no que se llena solo | ✅ Cerrada |
| D-16 | Distribución **pública** en dos canales: **comando global `gsql`** (campo `bin` de npm + `npm link`, entregado con el instalador bootstrap de SPEC-32) e **imágenes Docker publicadas en Docker Hub** (`pclota/graphsql-cli` y `pclota/graphsql-postgres-demo`, SPEC-33), con instalación de la demo sin clonar el repo; sin ejecutable standalone. La frontera de confidencialidad son los **datos del cliente**, no la distribución | Dos públicos, dos canales (SPEC-31): quien trabaja con el proyecto quiere invocar el CLI desde cualquier carpeta (para eso las rutas a recursos se resuelven desde el código, no desde el cwd), y quien solo quiere evaluar la demo no debería necesitar Node — con Docker le basta. Un ejecutable standalone (pkg/SEA) no resuelve nada real: la aplicación necesita el repo al lado igualmente (compose, scripts de init, prompts editables como texto). Sobre publicar: primero lo descarté por prudencia con el on-premise y lo revisé el mismo día — el repo ya es público; lo que no puede salir nunca son los datos del cliente (esquemas, descripciones, resultados de sus bases de datos) ni ninguna clave. Los artefactos publicados se auditan antes de subir: la imagen del CLI lleva solo la config de ejemplo y los `*.example.json` de `descriptions/` (la carpeta real queda excluida por partida doble: COPY explícito fichero a fichero + `.dockerignore`), y la de Postgres solo las bases sintéticas generadas por seed | ✅ Cerrada |
| D-17 | Zod como validador único en tres fronteras: variables de entorno (`env.ts`), respuestas JSON del LLM (Judge, juez de equivalencia) y filas de Neo4j/Postgres/ficheros de evaluación en el borde de infraestructura | Antes cada factory repetía `env.X ?? 'default'` a mano, y los parsers de respuestas del LLM eran ~50 líneas de funciones sueltas (`toStringArray`, `toConfidence`, `toTablePurposes`…) reinventando la misma tolerancia (campo mal formado → valor neutro, nunca tumbar todo el veredicto). Un esquema declarativo dice lo mismo en menos código y falla con un mensaje claro en el momento en que la variable o la respuesta no cuadra, en vez de un `NaN` o un `undefined` silencioso más abajo. Uso `.catch()` para mantener la misma tolerancia de antes (un campo opcional mal formado no debe invalidar el resto), y solo valido donde de verdad entran datos que no controlo (entorno, LLM, fila externa) — no meto Zod en los tipos internos del dominio, que ya los valida TypeScript | ✅ Cerrada |
| D-18 | Un **tercer proveedor** `gateway` (servidor LLM de la organización, LiteLLM y compatibles) para chat y embeddings, con sus propias variables y su opción en los menús, en lugar de reaprovechar la rama local apuntando la URL a otro sitio | Es el punto medio que manda en una empresa: ni la nube de un tercero ni lo que cabe en un portátil, sino un servidor propio que habla la API de OpenAI y decide él qué modelo hay detrás. Encaja con el on-premise (D-14) sin contradecirlo — las preguntas y el esquema no salen del perímetro — y concentra en un solo sitio la clave, la cuota y la traza, que es lo que no puede dar el modo local. Lo separo del proveedor local en vez de reusarlo porque el CLI enseña el nombre del proveedor antes de cada sesión y el índice vectorial guarda con cuál se indexó: llamar "local" a un servidor corporativo haría mentir a las dos cosas. Dos detalles obligan a código y no a configuración: el gateway publica **alias** de modelo propios (el aviso de "ese modelo no existe" consulta su `/models`, y con la clave, porque sin ella responde 401) y el recorte de dimensión de embeddings solo vale con `text-embedding-3`, así que pedirlo es explícito (`GATEWAY_EMBEDDING_SEND_DIMENSIONS`) y no un supuesto | ✅ Cerrada |

### 3.1 Patrón obligatorio: acceso a recursos externos (puerto + adaptador + factory)

Todo acceso a un recurso externo (BD objetivo, LLM, embeddings, store de vectores…) sigue **siempre** este patrón. Es la forma de respetar Clean Architecture y de no acabar con clientes hardcodeados ni `if (tipo === …)` repartidos por los casos de uso. Si tengo que añadir un recurso o un nuevo proveedor/motor, estos son los pasos:

1. **Puerto** en `domain/ports/I<Recurso>.ts`: solo los métodos que necesitan los casos de uso. Si el recurso es una conexión con ciclo de vida, incluye `close()`. El dominio no conoce ningún driver.
2. **Adaptador(es)** en `infrastructure/<recurso>/<Proveedor><Recurso>.ts` (PascalCase, uno por clase): implementa el puerto para un proveedor/motor concreto (p. ej. `PostgresTargetDatabase`).
3. **Factory** en `infrastructure/<recurso>/<Recurso>Factory.ts`: el **único** sitio que importa adaptadores concretos. Elige cuál instanciar según la configuración (`switch` por tipo/proveedor) y devuelve el **puerto** ya listo. Ejemplos: `ChatModelFactory`, `EmbeddingsFactory`, `TargetDatabaseFactory`, `SchemaReaderFactory`. Si una operación es específica del motor (p. ej. el dry-run de sintaxis), va como método del puerto y la implementa cada adaptador, no el caso de uso.
4. **Casos de uso**: reciben el puerto por **inyección de dependencias** (objeto de `deps` con un default real que llama al factory). **Nunca** importan adaptadores concretos ni discriminan el tipo de motor; solo dependen de la abstracción.
5. **Tests**: doblo el puerto (o la función del factory que lo devuelve) → unitarios offline, sin Docker ni red.

> **Anti-patrón a evitar:** construir el cliente a mano (`new PostgresX(...)`) o decidir el motor (`if (target.type !== 'postgresql')`) dentro de un caso de uso. Si eso aparece en la capa de aplicación, va al factory. Lo aprendí rehaciendo `executeQuery`/`checkSqlSyntax`/`readTargetSchema`, que repetían ese hardcode hasta que lo centralicé en `TargetDatabaseFactory`.

> **En vocabulario GoF**, este patrón es el tándem **Factory + Strategy** aplicado a la frontera de la arquitectura: los adaptadores son las estrategias por tecnología (mismo contrato, implementación distinta por proveedor/motor) y el factory es el único punto de selección/instanciación — y crea solo la estrategia elegida. La diferencia de nombre es de intención: Strategy encapsula *algoritmos* intercambiables; aquí la variación es *tecnología externa*, por eso hablamos de puerto/adaptador (hexagonal). Donde la variación sí es de algoritmo, el proyecto usa Strategy puro con funciones/objetos en vez de clases (los tres modos de recuperación del ablation, los paquetes de deps inyectados como `PipelineDependencies`; `makePipelineDependencies(target)` es un factory que fabrica el paquete de estrategias ligado a una BD concreta). Y las operaciones específicas de motor (p. ej. el `dryRun` del Judge) van como método del puerto para que cada adaptador aporte SU estrategia — añadir un motor nuevo es un adaptador + un case en el factory, sin tocar los casos de uso.

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
| SPEC-09 | Memory Agent / Store Feedback: consultas guardadas como ejemplos *few-shot* (tabla `saved_queries`, guardado explícito, D-15) | 🔮 Futuro (fuera del MVP; especificada y lista para implementar) |
| SPEC-10 | Supervisor (enrutador determinista) — al final, una vez existen las piezas | ✅ Cerrada |
| SPEC-11 | Integración CLI completa + Evaluación experimental (ablation sobre el golden set) | ✅ Cerrada (arnés + experimento ejecutado; ablation de 3 modos y de descripciones, informes en `docs/evaluacion/`) |
| SPEC-12 | Gestión de conversaciones: nombrar, listar y reanudar hilos | 🔮 Futuro (fuera del MVP) |
| SPEC-13 | Explicabilidad de la recuperación (traza del GraphRAG) + modo depuración en el CLI | ✅ Cerrada |
| SPEC-14 | El Judge evalúa la certeza del propósito de las tablas usadas (documentada / evidente / supuesta) | ✅ Cerrada |
| SPEC-15 | Afinar la consulta en la revisión con indicaciones en lenguaje natural (fusiona la acción "fijar tablas") | ✅ Cerrada |
| SPEC-16 | Seguimiento conversacional de una consulta (pregunta de seguimiento tras ejecutar) | 🔮 Futuro (fuera del MVP) |
| SPEC-17 | Prueba de escala: segunda BD objetivo grande (sintética, 66 tablas) + evaluación multi-BD | ✅ Cerrada (arnés + ejecutado; GraphRAG plano 774→759 tokens de 17→66 tablas, recall 99%→100%) |
| SPEC-18 | Selección de la BD objetivo en el flujo de consulta (catálogo + índice consciente de su BD) | ✅ Cerrada |
| SPEC-19 | Presentación gráfica de resultados en consola (tabla / gráfico de barras / ambas) | ✅ Cerrada |
| SPEC-20 | Índice multi-inquilino: varias BDs indexadas a la vez en Neo4j/pgvector | 🔮 Futuro (fuera del MVP) |
| SPEC-21 | Experimento de confusión: tablas y columnas con nombres opacos, ¿quién sobrevive sin descripciones? | ✅ Cerrada (sin descripciones se hunden todos los modos; con ellas, GraphRAG resuelve 4 de 6 vs 0 de 6 del esquema entero — la recuperación hace la documentación usable; re-medido en 2 tiradas tras la auditoría 2026-07-09) |
| SPEC-22 | Relaciones sintéticas en Neo4j: aristas curadas para BDs sin FKs declaradas | 🔮 Futuro (fuera del MVP; especificada) |
| SPEC-23 | Plantillas parametrizadas: consultas aprobadas reutilizables con parámetros tipados | 🔮 Futuro (fuera del MVP; especificada) |
| SPEC-24 | Widgets bajo demanda: SQL aprobada ejecutada sin LLM para dashboards | 🔮 Futuro (fuera del MVP; especificada) |
| SPEC-25 | Consultas favoritas: guardar con nombre, listar y reejecutar directamente (sin agentes, con la barrera de seguridad) | 🔮 Futuro (fuera del MVP; comparte la tabla `saved_queries` con SPEC-09, D-15) |
| SPEC-26 | Recuperación por capas para esquemas grandes: ranking léxico + expansión por grafo + selector LLM, sobre el ERP real (~800 tablas) | ✅ Cerrada |
| SPEC-27 | Generador automático de descripciones de tabla (con un LLM, desde columnas, claves y una muestra opcional de filas) | ✅ Cerrada |
| SPEC-28 | Arranque guiado del CLI: preflight de infraestructura (Docker, contenedores healthy) y primera vez sin índice vectorial | ✅ Cerrada |
| SPEC-29 | Actualización incremental de descripciones: re-vectoriza solo las tablas cuya descripción cambió | ✅ Cerrada |
| SPEC-30 | Observabilidad local del pipeline con Arize Phoenix + OpenTelemetry, auto-alojado y opt-in | 🔮 Futuro (fuera del MVP) |
| SPEC-31 | Distribución: comando global `gsql` (`npm link`) e imagen Docker de demo (profile `demo` del compose) | ✅ Cerrada |
| SPEC-32 | Instalador bootstrap de un comando para Windows y Linux/macOS (`install.ps1` / `install.sh`) | ✅ Cerrada |
| SPEC-33 | Imágenes publicadas en Docker Hub e instalación de la demo sin clonar el repo | ✅ Cerrada |
| SPEC-34 | Zod como validador único en las fronteras externas (entorno, respuestas del LLM, filas de infraestructura) | ✅ Cerrada |

> **Caso para evaluar las descripciones (hecho en SPEC-04, queda cuantificar en SPEC-11).** Para comprobar que las descripciones aportan de verdad, Arcadia incluye `t_042`, una tabla con **nombre opaco** (no delata que guarda las listas de deseos) y una pregunta del golden set que la necesita (G-25). En SPEC-04 ya validé a mano que con descripciones se recupera y sin ellas no. Lo que queda para SPEC-11 es **medirlo sobre todo el golden set** (con/sin descripciones, además de con/sin grafo). El porqué, en [arquitectura.md §10](arquitectura.md).

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
- [X] El esquema de Arcadia tiene las tablas esperadas (16 al validarse; hoy son 17 tras añadir la tabla opaca `t_042` para el caso de schema-linking por descripción)
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

**Objetivo.** Quiero una primera interfaz de consola, agradable y con color, que me deje arrancar la aplicación, elegir con qué LLM hablar y hacerle una pregunta. Es el primer hito visible de extremo a extremo: del menú al modelo y vuelta. La versión completa (CLI integrado con todo el pipeline de agentes y la aprobación humana) queda para SPEC-11; aquí solo monto el esqueleto y la primera conversación directa con el modelo.

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

> **Nota (D-12, 2026-07-04).** El chat conversacional cumplió su objetivo (validar la orquestación) y su código se **conserva** (`agentGraph` + `schemaTools`/`sqlTools`) como base reutilizable, pero **ya no se expone en el menú del CLI**: el pipeline NL→SQL con revisión (SPEC-08/10/15) cubre el caso de uso real. Reactivarlo es volver a añadir su opción de menú en `main.ts`.

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

**Objetivo.** Quiero poder encontrar las tablas relevantes para una pregunta aunque el usuario no use los nombres exactos del esquema (pregunta "clientes" → tabla `customer`; pregunta en español sobre esquema en inglés). Para eso vectorizo cada tabla con un modelo de embeddings y guardo el vector en pgvector, listo para la búsqueda semántica que hará el Schema Agent (SPEC-04). El razonamiento de fondo está en [`docs/proceso/investigacion/embeddings.md`](../proceso/investigacion/embeddings.md).

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
- **Capa 3 — LLM-as-judge (opcional).** A través de `IChatModel`, el LLM revisa la SQL contra el contexto por varios criterios (sintaxis, semántica con nombres reales y JOINs por FK, completitud respecto a la pregunta, seguridad y optimización) y devuelve un veredicto rico: válido o no, **confianza (0..1)**, errores, avisos, sugerencias, tablas verificadas y una explicación. Tomé como referencia el juez del proyecto Python anterior. **El juez LLM no bloquea por sí solo**: sus "errores" los muestro como avisos, porque puede ser demasiado estricto y dar falsos positivos. Quien bloquea es la Capa 1 (seguridad) y la Capa 2 (sintaxis real). Puedo exigir una confianza mínima (`minConfidence`) como palanca del operador. La confianza mide si la consulta **responde a la pregunta con datos reales del esquema**, no solo si su sintaxis es correcta: una consulta que devuelve un texto literal en vez de datos (p. ej. `SELECT 'no se puede responder…' AS mensaje`) puntúa bajo, de modo que el umbral la invalide y el supervisor (SPEC-10) reintente en vez de presentarla en la revisión como válida. Si su respuesta no es interpretable, lo trato como error de dominio (no rompe el flujo). Inyecto el `IChatModel`.

El veredicto es lo que mira el supervisor (SPEC-10): si no supera el Judge (inválido o por debajo del umbral de confianza) y quedan reintentos, vuelve al SQL Agent con los errores; si se agotan los reintentos, la consulta pasa a la revisión humana marcada como fracasada (no ejecutable); si lo supera, sigue el circuito normal. La política completa, en SPEC-10.

**Pasos**

1. Definir en el dominio el veredicto de validación (válido + errores/avisos; el rico, con confianza/sugerencias, para el juez LLM).
2. Implementar la **Capa 1 (seguridad)** como servicio de dominio puro: allowlist `SELECT`/`WITH`, keywords peligrosas (palabra completa), patrones de inyección. Constantes con nombre para las listas.
3. Tests de la Capa 1 (seguridad): tabla parametrizada con un caso por keyword peligrosa y por patrón de inyección, más `SELECT`/CTE legítimos que pasan.
4. Implementar la **Capa 2 (sintaxis real)**: pedir el dry-run a la conexión (`ITargetDatabase.dryRun`); si lanza, inválida con el error de la BD.
5. Implementar la **Capa 3 (juez LLM)** como caso de uso con `IChatModel` inyectado; parsear el veredicto y, si no es interpretable, error de dominio que no rompe el flujo.
6. Combinar: bloquean la Capa 1 (seguridad) y la Capa 2 (sintaxis real); el juez LLM (Capa 3) solo aconseja (sus errores pasan a avisos). Dejarlo listo para el bucle del supervisor (reintento SQL↔Judge).

**Criterios de aceptación**

- [X] Una sentencia que no empiece por `SELECT`/`WITH` se marca inválida
- [X] Presencia de `DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|GRANT` (palabra completa) → inválida, con error explícito
- [X] Patrones de inyección (`;` multi-sentencia, `--`, `/* */`) → inválida
- [X] Un `SELECT` legítimo con JOINs y CTE → válida
- [X] Si la Capa 1 (seguridad) rechaza, el resultado lo deja claro y el flujo no llega a ejecutar (invariante de seguridad)
- [X] (Capa 2, sintaxis real) `EXPLAIN` contra la BD: si la BD acepta la consulta es válida; si la rechaza, inválida con el error de la BD
- [X] (Capa 3, juez LLM) dado SQL + contexto, devuelve un veredicto; **el juez LLM no bloquea por sí solo** (sus errores pasan a avisos); si responde algo no interpretable, se trata como error de dominio sin romper
- [X] Tests: Capa 1 (seguridad) con tabla parametrizada (pura, sin dobles); Capa 2 (sintaxis real) con doble de la conexión (`dryRun`); Capa 3 (juez LLM) con `IChatModel` doblado

```bash
cd backend && npm test                   # Capa 1 (seguridad, pura) + Capa 2 (sintaxis real) y Capa 3 (juez LLM) con dobles
```

---

### SPEC-07 — Execute (ejecución segura de solo lectura)

**Objetivo.** Una vez tengo una consulta validada (SPEC-06), quiero ejecutarla de verdad contra la BD objetivo y traer los resultados. Es el paso que convierte la SQL en datos. Lo importante aquí no es solo ejecutar, sino hacerlo **sin poder hacer daño**: solo lectura, con la Capa 1 (seguridad) del Judge como última barrera justo antes de lanzar la consulta, y con topes que eviten que una consulta enorme o lenta tumbe el terminal.

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

> **Actualizado en SPEC-15.** La acción "fijar tablas" ya no es una opción propia: quedó subsumida en la acción **"Afinar"** (SPEC-15), que combina una indicación en lenguaje natural con las tablas a forzar. El comportamiento determinista de las tablas (`mustInclude`) se conserva íntegro; forzar tablas es ahora el caso de afinar sin indicación de texto.

Hay un caso especial: una consulta que **no logró pasar el Judge** tras agotar los reintentos (ver SPEC-10) también llega aquí, pero marcada como **fracasada**. La veo y la puedo evaluar (con el veredicto del Judge a la vista), pero **no se puede aprobar para ejecutar**: las opciones útiles son rechazar, modificarla a mano o fijar tablas y relanzar. Así el usuario siempre tiene la última palabra sobre la consulta, sin que se ejecute algo que el Judge no avaló.

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
- [X] Tests de integración con checkpointer: pausa/persistencia (recuperable por `thread_id`). Las ramas aprobar/fijar-tabla las cubren los tests unitarios con `MemorySaver` (mismo comportamiento, sin Docker); el test de integración se centra en lo que un doble no puede demostrar: la persistencia real en PostgreSQL

```bash
cd backend && npm run test:integration   # human review con checkpointer (opt-in)
```

---

### SPEC-09 — Memory Agent: reutilizar consultas guardadas como ejemplos *few-shot* 🔮 *Futuro (fuera del MVP)*

**Objetivo.** Cerrar el círculo del human-in-the-loop: cada consulta que sale bien es una **etiqueta de calidad gratis** (pregunta en lenguaje natural + SQL cuyo resultado el usuario ha visto y dado por bueno). Quiero guardarlas y, ante una pregunta nueva parecida, pasarle al SQL Agent las más similares como ejemplos *few-shot*, para que acierte más en preguntas recurrentes y aprenda las convenciones del dominio (cómo se calcula "activo", qué significa "ingresos"…). Son las dos piezas que la visión llama **Store Feedback** (guardar) y **Memory Agent** (recuperar). La tabla y el momento de guardado los comparto con las favoritas (SPEC-25): la decisión está en **D-15**.

**Contrato.**

- *Guardar es explícito y tras ver el resultado (Store Feedback, D-15).* Aprobar la SQL valida el texto; ver el resultado valida la RESPUESTA. Por eso el guardado NO es automático al aprobar: tras presentar el resultado, ofrezco guardar la consulta y, si el usuario quiere, marcarla como ejemplo para el agente (`use_as_example`). Se guarda la pregunta, la SQL final (la editada a mano vale aún más: lleva corrección humana), la BD objetivo, las tablas usadas y la fecha, junto al **embedding de la pregunta**. Guardar es **no crítico**: la consulta ya se ejecutó, así que un fallo al guardar solo genera un aviso y sigue.
- *Una sola tabla con flags (D-15).* `saved_queries` vive en `graphsql_memory` (separada del índice de esquema y de los checkpoints). La misma fila sirve a la memoria y a las favoritas de SPEC-25, distinguidas por flag: la recuperación *few-shot* solo mira las que tienen `use_as_example = true`. Una columna `user_id` (hoy un valor por defecto) deja el por-usuario para el futuro sin migrar el esquema.
- *Recuperar por similitud (Memory Agent).* Ante una pregunta nueva, se embebe y se buscan las top-K preguntas guardadas (con `use_as_example`) más parecidas **de la misma BD objetivo** (lección de SPEC-18: nunca ejemplos de Arcadia para preguntas de Nebula), filtrando por un umbral de similitud. Palancas ya reservadas en el `.env`: `SIMILARITY_THRESHOLD` (0.75) y `MAX_FEEDBACK_EXAMPLES` (5). Sin ejemplos por encima del umbral, el pipeline sigue exactamente como hoy (la memoria es aditiva, nunca bloqueante).
- *Mismo modelo de embeddings que el índice* (lección de D-06): se embebe y se busca con el modelo del índice actual; guardo el modelo/dimensión junto al vector, y si el índice se re-vectoriza con otro modelo, los embeddings de la memoria se regeneran igual (o se invalidan con aviso).
- *Integración en el grafo.* Un nodo `memory` al empezar el ciclo (antes de generar) añade los ejemplos al estado; `generateSql` los recibe como bloque *few-shot* en el prompt (pregunta → SQL, N ejemplos). El enrutado no cambia: la memoria enriquece, no decide.
- *Transparencia en la revisión.* Si se usaron ejemplos, la caja de la consulta lo dice ("apoyada en N consultas similares guardadas"), para que el usuario sepa de dónde viene el estilo de la SQL — mismo criterio de explicabilidad que la traza de recuperación (SPEC-13).
- *Medir el aporte SIN trampa.* El arnés de evaluación gana un modo "con memoria", pero con **leave-one-out obligatorio**: al evaluar un caso se excluyen de la memoria ese mismo caso y cualquier pregunta idéntica — si no, sembrar la memoria con el golden set y evaluar sobre el golden set sería filtración (el ejemplo *es* la respuesta) y el número saldría inflado. Este sesgo se declara en la sección de sesgos de `arquitectura.md` §10 el día que se mida.
- *Semilla manual y etiquetas (el "gestor de consultas").* Además de las guardadas desde el pipeline, puedo **sembrar** filas a mano en `saved_queries`: una pregunta + su SQL (p. ej. una consulta que ya sé buena de mi ERP), con los flags que elija (`use_as_example`, `is_favorite` + título) y **etiquetas** opcionales (columna `tags`: "facturación", "stock"…). El Memory Agent las usa igual que las guardadas del pipeline (few-shot por similitud; la etiqueta puede reforzar el filtrado). Dos caminos, un almacén: el implícito (el agente se apoya en ellas cuando le hacen falta) y el explícito (recuperarlas de favoritas, SPEC-25, o convertirlas en plantilla, SPEC-23).
- *Mantenimiento mínimo.* Una forma de vaciar la memoria (por BD o entera) desde el CLI o un script, y de borrar/editar una entrada sembrada; sin más gestión fina en esta fase.

**Pasos**

1. Tabla `saved_queries` en `graphsql_memory` (pregunta, SQL, BD, tablas, embedding, modelo/dimensión, `use_as_example`, `is_favorite`, `title` nulo, `tags` opcionales, `user_id` por defecto, fecha) detrás de un puerto + adaptador + factory (patrón D-05), separada del índice de esquema. Compartida con SPEC-25.
2. Caso de uso `storeSavedQuery` (deps inyectadas): lo llama el CLI tras presentar el resultado, con los flags que elija el usuario; fallo → aviso, no rotura.
3. Caso de uso `findSimilarSavedQueries(question, target)`: embeber con el modelo del índice, buscar top-K de la misma BD con `use_as_example`, filtrar por umbral.
4. `generateSql` acepta ejemplos *few-shot* opcionales y los inyecta en el prompt con formato estable.
5. Nodo `memory` en el pipeline + canal `examples` en el estado; el CLI muestra la línea de transparencia en la revisión y el prompt de guardado tras el resultado.
6. Evaluación: modo "con memoria" con leave-one-out; comparar con/sin memoria sobre el mismo golden set y declarar el método.
7. Tests con dobles: guardar solo con el flag pedido, no romper si falla el guardado, filtrar por BD/flag/umbral, prompt con ejemplos, leave-one-out.

**Criterios de aceptación**

- [ ] Tras ver el resultado puedo guardar la consulta y marcarla como ejemplo; sin marcarla, no entra en la memoria *few-shot*; un fallo al guardar no rompe el flujo
- [ ] Ante una pregunta parecida, el SQL Agent recibe como mucho `MAX_FEEDBACK_EXAMPLES` ejemplos (`use_as_example`) de la MISMA BD por encima de `SIMILARITY_THRESHOLD`; sin ejemplos, el pipeline se comporta exactamente como hoy
- [ ] La revisión muestra si la consulta se apoyó en ejemplos (transparencia)
- [ ] El aporte se mide con leave-one-out y se declara el método (sin filtración golden set → memoria → golden set)
- [ ] Puedo sembrar a mano una pregunta + SQL con etiquetas y flags; entra en `saved_queries` y el Memory Agent la usa igual que una guardada desde el pipeline (listar y reejecutar viven en SPEC-25)
- [ ] Suite unitaria verde con dobles, sin Docker ni LLM

---

### SPEC-10 — Supervisor (enrutador determinista)

**Objetivo.** Unir todas las piezas en un único flujo, enrutado con reglas sobre el estado compartido (no con un LLM): Schema → SQL → Judge → (decisión) → Human Review → Execute. Formalizo sobre el esqueleto del pipeline (SPEC-08) el bucle automático de reintento que hasta ahora faltaba: si el Judge no da la consulta por buena, vuelve al SQL Agent con sus errores antes de subirla a que la revise el usuario.

**Contrato.**

- *El bucle Judge↔SQL vive dentro del propio grafo del pipeline (SPEC-08), no es un módulo aparte.* Tras el Judge, si el veredicto no es válido (falla la Capa 1 de seguridad o la Capa 2 de sintaxis real, o su confianza queda por debajo de `MIN_CONFIDENCE`) y quedan intentos, el pipeline vuelve automáticamente al SQL Agent — sin pasar por Human Review ni rehacer la recuperación (las tablas no cambian, solo la SQL).
- *Umbral y tope de intentos, configurables.* `MIN_CONFIDENCE` (confianza mínima del juez LLM para dar la consulta por buena) y `MAX_JUDGE_ATTEMPTS` (número total de intentos de generación, contando el primero) son constantes con nombre, igual que `SEMANTIC_TOP_K`/`MAX_CONTEXT_TABLES` en la recuperación: son las palancas del *ablation* (SPEC-11).
- *El SQL Agent corrige, no repite a ciegas.* En un reintento, `generateSql` recibe también la SQL del intento anterior y los errores/avisos del Judge, para que el LLM corrija el problema concreto en vez de generar de cero (y, previsiblemente, repetir el mismo fallo).
- *El reintento automático no se aplica a una SQL editada a mano.* Si el usuario modificó la consulta (`modify`, SPEC-08), el veredicto del Judge sobre esa edición siempre vuelve a Human Review, gane o pierda: el reintento automático descartaría en silencio lo que el usuario acaba de escribir, y eso no es aceptable.
- *Si se agotan los intentos sin superar el Judge* → la consulta llega a Human Review marcada como **fracasada** (ya montado en SPEC-08): se ve, se puede rechazar, modificar a mano o fijar tablas y relanzar, pero no aprobar.
- *Si lo supera dentro de los intentos* → sigue el circuito normal: Human Review y, tras la aprobación, Execute.
- *El contador de intentos se reinicia al entrar en la recuperación (`retrieve`)*: tanto al empezar como al fijar tablas y relanzar, porque es un ciclo nuevo.

**Pasos**

1. Ampliar el contrato de `generateSql` (SPEC-05) para aceptar, opcionalmente, el intento anterior (la SQL y los errores/avisos del Judge) y ajustar el prompt para pedir explícitamente la corrección del problema señalado, no una generación desde cero.
2. Añadir al estado del pipeline (`PipelineState`, SPEC-08) el contador `attempts`, inicializado y reiniciado en el nodo `retrieve`.
3. Pasar `minConfidence: MIN_CONFIDENCE` a `judgeSql` desde las dependencias por defecto del pipeline (hoy no se pasaba, así que la opinión del juez LLM nunca invalidaba la consulta).
4. Nueva función de enrutado tras el Judge (`routeAfterJudge`): válido → Human Review; inválido y la SQL viene de una modificación manual → Human Review (sin reintento); inválido, no es una modificación manual y quedan intentos → sumar uno y volver al SQL Agent con el error; inválido y agotados los intentos → Human Review (fracasada).
5. En el CLI (revisión humana): mostrar cuántos intentos ha hecho el SQL Agent antes de llegar a la revisión (transparencia, en línea con SPEC-13).
6. Tests: unit con dobles — reintenta hasta `MAX_JUDGE_ATTEMPTS` pasando el error al SQL Agent en cada vuelta; si supera el Judge antes de agotarlos, sigue a Human Review; si los agota, llega a Human Review fracasada; una SQL modificada a mano no entra en el bucle automático aunque el Judge la invalide; fijar tablas reinicia el contador.

**Criterios de aceptación**

- [X] Si el Judge invalida la consulta (o su confianza queda por debajo de `MIN_CONFIDENCE`) y quedan intentos, el pipeline vuelve automáticamente al SQL Agent con los errores del Judge, sin pasar por Human Review
- [X] El SQL Agent recibe el intento anterior y los errores, y la nueva consulta intenta corregir el problema señalado
- [X] `MIN_CONFIDENCE` y `MAX_JUDGE_ATTEMPTS` son constantes con nombre, configurables para el *ablation* (SPEC-11)
- [X] Una SQL modificada a mano por el usuario nunca entra en el reintento automático: su veredicto del Judge vuelve siempre a Human Review
- [X] Si se agotan los intentos sin superar el Judge, la consulta llega a Human Review marcada como fracasada (no se puede aprobar)
- [X] Si el Judge la da por buena dentro de los intentos, sigue el circuito normal (Human Review → Execute)
- [X] Fijar tablas y relanzar reinicia el contador de intentos (es un ciclo nuevo)
- [X] En la revisión humana se ve cuántos intentos ha hecho el SQL Agent
- [X] Tests unit con dobles: reintento hasta el tope con el error propagado, éxito antes de agotarlos, agotamiento → fracasada, modificación a mano exenta del reintento, reinicio del contador al fijar tablas

```bash
cd backend && npm test    # unit del bucle de reintento Judge↔SQL (con dobles)
```

---

### SPEC-11 — Integración CLI final + evaluación experimental (ablation)

**Objetivo.** Cerrar el proyecto por dos lados. **(A)** Dejar el CLI listo para la demo: que desde el menú se llegue con fluidez a todo lo construido (conversar, escanear, consultar con revisión, depurar recuperación). **(B)** Medir lo que hasta ahora solo afirmo: que la recuperación GraphRAG localiza las tablas relevantes **sin volcar todo el esquema**, y que las descripciones rescatan tablas de nombre opaco. La evaluación no busca rigor estadístico de tribunal universitario (el golden set es pequeño, un solo dominio y un solo modelo, y lo declaro), sino **pocos números claros y honestos que se vean en la presentación**: cuánto contexto ahorro, cuántas tablas correctas recupero, y el caso `t_042`.

**Contrato.**

*Parte A — CLI final.* El menú principal da acceso a: conversar con el agente, escanear/vectorizar el esquema, lanzar una consulta con revisión humana (pipeline SPEC-08/10/15) y depurar la recuperación (SPEC-13). Un recorrido de demo va del menú a cada función y vuelve sin romperse.

*Parte B — evaluación (ablation sobre el golden set).*

- *Dataset*: el golden set de Arcadia ([`golden_set.yaml`](../../setup/datasets/arcadia/golden_set.yaml), 25 casos G-01..G-25), cada uno con la pregunta, las tablas que la SQL correcta debe tocar (`tables`) y la SQL de referencia (`sql`).
- *Variable independiente — modo de recuperación*, tres niveles:
  - **sin recuperación**: el contexto es el esquema ENTERO (todas las tablas). Baseline que revienta el contexto.
  - **solo vectorial**: las top-K tablas por similitud, SIN expandir por claves foráneas.
  - **GraphRAG completo**: top-K + expansión por FK en el grafo (lo actual).
- *Segunda dimensión — descripciones on/off*: con y sin las descripciones de las tablas, para aislar su aporte. Cada nivel exige (re)vectorizar el índice en ese modo (con/sin la descripción en el texto embebido) y renderizar el DDL con/sin el comentario de descripción. Es el paso más pesado; si el tiempo aprieta, como mínimo la comparación dirigida sobre G-25 (`t_042`).
- *Métricas por caso y modo*:
  - **schema-linking recall**: de las tablas `gold`, cuántas aparecen en el contexto recuperado (∩ / total). Aísla la recuperación; no depende de que el LLM acierte la SQL.
  - **tamaño de contexto**: nº de tablas (y un estimado de tokens del DDL) que se le pasan al SQL Agent. Es lo que enseña que "sin recuperación" no escala.
  - **execution accuracy**: ejecuto la SQL candidata (la que genera el sistema en ese modo) y la SQL de referencia contra Arcadia en solo lectura y comparo el RESULTADO (mismo conjunto de filas, sin importar el orden). Solo ejecuto la candidata si pasa la comprobación de seguridad; si no, cuenta como fallo.
  - **equivalencia semántica (LLM, complementaria, D-11)**: si la candidata es ejecutable, un segundo LLM juzga si responde a la MISMA pregunta que la de referencia. Recupera aciertos que la comparación de resultados descarta (empates en un top-N, columnas descriptivas de más, agregaciones equivalentes) y que la no-idempotencia del LLM haría casi imposibles de igualar por resultado exacto. Se reporta **al lado** de la execution accuracy, nunca en su lugar: un LLM-juez también se equivoca (la equivalencia de consultas es indecidible en general), así que la métrica objetiva sigue siendo la titular.
- *Salida*: un informe reproducible (tabla en consola + fichero CSV/JSON y un resumen en `docs/evaluacion/`) agregando por modo (recall medio, tamaño de contexto medio, execution accuracy %) y desglose por dificultad (easy/medium/hard). Los números salen tal cual para las slides.
- *Honestidad*: el informe declara sus límites (golden set de 25, un dominio, un modelo, generación no determinista → indico si es una tirada o media de N), y la baseline es justa (sin recuperación / solo vectorial / GraphRAG), no un ninot de palla. **Aviso de escala**: a las ~17 tablas de Arcadia, la baseline "sin recuperación" puede aún responder bien porque el esquema entero cabe en el contexto; por eso a esta escala el argumento lo carga el **tamaño de contexto/tokens**, y la brecha de execution accuracy se espera que crezca con el tamaño del esquema (lo confirmaría la BD pública grande opcional).

**Pasos**

1. Cargador del golden set: leer `golden_set.yaml` a una lista de casos tipados (`id`, `question`, `difficulty`, `tables`, `sql`).
2. Modos de recuperación reutilizando la DI de SPEC-04: `graphrag` = deps reales; `solo vectorial` = `expandByForeignKeys` sustituido por una lectura que devuelve solo las tablas candidatas con sus columnas/claves, sin vecinas (añadir esa lectura al grafo si no existe); `sin recuperación` = saltar la recuperación y construir el contexto con TODAS las tablas (`readTargetSchema` + `buildSchemaContext`).
3. Descripciones on/off: parametrizar la (re)vectorización y el render del DDL para incluir o no la descripción; documentar el paso de re-vectorizar entre condiciones.
4. Caso de uso `evaluateGoldenSet(cases, mode, deps)` (capa aplicación, deps inyectadas con real por defecto): por cada caso recupera en el modo dado → genera la SQL → comprueba seguridad → ejecuta candidata y referencia → calcula recall, tamaño de contexto y execution accuracy. Devuelve resultados estructurados (no pinta nada).
5. Comparación de resultados de ejecución: igualdad de conjuntos de filas independiente del orden (multiset), normalizando tipos básicos.
6. Runner/script (`npm run evaluate`, opt-in, requiere Docker + LLM): corre los tres modos (y descripciones on/off si hay tiempo), agrega y escribe el informe (consola + fichero). Opcional: una entrada de menú en el CLI para lanzarlo en la demo.
7. Redactar en `arquitectura.md` §10 (evaluación experimental) la lectura de los números y sus límites; volcar la narrativa al diario.
8. Tests: unit con dobles del cálculo de métricas (recall, comparación de result sets, tamaño de contexto) sin tocar BD ni LLM; el runner completo es integración opt-in.

**Criterios de aceptación**

- [X] Desde el menú del CLI llego a conversar, escanear, consultar con revisión y depurar recuperación, y vuelvo sin que la app se rompa
- [X] El cargador lee los 25 casos del golden set con sus tablas `gold` y su SQL de referencia
- [X] Los tres modos de recuperación (sin recuperación / solo vectorial / GraphRAG) están implementados y producen contextos distintos
- [X] Por cada caso y modo obtengo: schema-linking recall, tamaño de contexto y execution accuracy (resultado candidato vs referencia)
- [X] La SQL candidata solo se ejecuta si pasa la comprobación de seguridad; si no, cuenta como fallo
- [X] El runner agrega por modo (y por dificultad) y guarda el informe de forma reproducible (`docs/evaluacion/`); declara sus límites
- [X] Tests unit con dobles del cálculo de métricas y de la orquestación; el runner completo es integración opt-in
- [X] Ejecutado `npm run evaluate` (chat OpenAI, embeddings locales): 3 modos → recall 100/93/99%, execution accuracy justa 72/68/64%, equivalencia (justa O juez) 88/84/80%, contexto 1498/481/774 tokens (una tirada; varía ~±8pp por no-determinación)
- [X] Ablation de descripciones (`npm run evaluate:descriptions`, 2×2): las descripciones suben recall y precisión; `t_042` (G-25) se recupera y acierta con descripciones, y en solo-vectorial falla sin ellas (GraphRAG la rescata por FK)
- [X] `arquitectura.md` §10 recoge la lectura neutra de los resultados; la lectura orientada a producto vive aparte, en el material de la presentación (fuera del repositorio)

```bash
cd backend && npm test                 # unit del cálculo de métricas (con dobles)
cd backend && npm run evaluate         # ablation completa sobre Arcadia (opt-in, Docker + LLM)
```

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
- *Contexto final*: las tablas tras acotar a `MAX_CONTEXT_TABLES`, cada una con su score y el **motivo** de inclusión (semántica / expansión / fijada por el usuario).
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

---

### SPEC-15 — Afinar la consulta en la revisión (indicaciones en lenguaje natural)

**Objetivo.** En la revisión (SPEC-08), cuando la consulta propuesta casi encaja pero no del todo, quiero poder decir en lenguaje natural qué ajustar ("añade también la popularidad por wishlist") y que el sistema rehaga la consulta con esa indicación, sin tener que rechazarla y reescribir la pregunta de cero. Es la vía **guiada por el usuario** del bucle: veo lo que ha propuesto y le doy más contexto para que lo valore y lo haga mejor. Aprovecho para **fusionar aquí la acción de "fijar tablas" de SPEC-08**: fijar tablas ya era un caso de afinar (una indicación estructurada), así que en vez de dos opciones separadas queda una sola, para no recargar el punto de revisión. Es la acción para el usuario técnico que ve que algo no está del todo bien; el seguimiento conversacional sobre los resultados ya ejecutados es otra cosa (SPEC-16).

**Contrato.**

- *Nueva acción de revisión "Afinar", que sustituye a "fijar tablas".* En la revisión, además de aprobar/rechazar/modificar-a-mano, puedo **Afinar**: doy (a) una **indicación en lenguaje natural** (opcional) y/o (b) una o varias **tablas a forzar** (opcional); exijo al menos una de las dos. El grafo rehace el ciclo (recuperación → SQL → Judge) y vuelve a pararse en la revisión.
- *Las tablas forzadas siguen siendo deterministas.* Como el "must-include" de SPEC-08, las tablas que indico entran seguro en el contexto (`mustInclude`), estén o no en el ranking; una que no existe en el esquema se avisa y se ignora (D-08, sin cambios).
- *La indicación guía la recuperación, la generación y el juicio.* La indicación se suma a la pregunta al **recuperar** (así "añade wishlist" puede hacer aparecer esa tabla por significado, sin obligarme a fijarla), y se le pasa al **SQL Agent** junto a la consulta anterior como punto de partida, para que la corrija/amplíe en vez de generar de cero. Es el mismo mecanismo del reintento del supervisor (SPEC-10), pero la "instrucción de qué mejorar" la escribe el usuario en lugar de venir de los errores del Judge. El **Judge** también la ve: evalúa la consulta contra la pregunta más las indicaciones acumuladas; si solo viera la pregunta original, penalizaría justo lo que acabo de pedir al afinar (p. ej. un alias que yo mismo solicité). Forzar una tabla es la garantía dura cuando no me quiero fiar de que la recuperación la traiga.
- *Afinar reinicia el ciclo del Judge.* Rehacer la recuperación reinicia el contador de intentos (SPEC-10): la consulta afinada dispone de sus `MAX_JUDGE_ATTEMPTS` de reintento automático como cualquier ciclo nuevo. Si la afinada tampoco pasa el Judge, se comporta igual (reintento automático y, si se agota, revisión marcada fracasada).
- *Iterativo.* Puedo afinar varias veces seguidas; cada afinado parte de la consulta actual (que ya incorpora los afinados anteriores) más mi nueva indicación. Las indicaciones se acumulan para la recuperación y las tablas forzadas también.
- *Separación de responsabilidades.* La indicación cambia **cómo** se escribe la SQL (y ayuda a encontrar tablas); forzar tablas garantiza **qué** tablas están disponibles.

**Pasos**

1. Cambiar `HumanDecision`: sustituir la acción `pin` (tablas) por `refine` con `{ guidance?: string, tables?: string[] }` (al menos uno no vacío).
2. Estado del pipeline (`PipelineState`): añadir `refinements: string[]` (acumula las indicaciones; persiste entre ciclos, no se reinicia en `retrieve`). `mustInclude` sigue existiendo para las tablas forzadas.
3. Generalizar el "punto de mejora" de `generateSql` (SPEC-05/10) de `{ sql, verdict }` a `{ previousSql, instructions: string }`, y mover el formateo del feedback del Judge (`describeJudgeFeedback`) fuera de `generateSql` al nodo `generate` del pipeline. Así `generateSql` deja de conocer `JudgeVerdict`: solo recibe "aquí tienes tu intento anterior y esto es lo que hay que ajustar", venga del Judge o del usuario.
4. Nodo `humanReview` (acción `refine`): acumular las tablas en `mustInclude`, añadir la indicación a `refinements`; enrutar a `retrieve`.
5. Nodo `retrieve`: la búsqueda semántica usa la pregunta **más las indicaciones acumuladas**; `mustInclude` fuerza las tablas indicadas; reinicia `attempts` (no toca `refinements`).
6. Nodo `generate`: si es el primer intento tras un afinado (hay indicaciones, `attempts === 0` y existe SQL previa) → guío con las indicaciones + la SQL anterior; si es un reintento automático del supervisor (`attempts > 0`, veredicto inválido) → con los problemas del Judge (SPEC-10).
7. CLI (revisión): sustituir la opción "fijar tablas" por **"Afinar"**, recogida con **dos sub-preguntas guiadas** (no una plantilla por rellenar, que en un terminal de una línea es frágil y obliga a parsear): primero la **indicación en lenguaje natural** (texto libre, con un ejemplo en el propio mensaje — es la principal), y después **forzar tablas** (nombres separados por comas, opcional, se salta con Enter). Exijo al menos una de las dos no vacía; si las dos van vacías, vuelvo a las opciones de la revisión sin relanzar. Seguir mostrando el aviso de tablas forzadas inexistentes (`ignoredPinned`).
8. Actualizar SPEC-08: la acción independiente "fijar tablas y relanzar" queda **subsumida** en la acción "Afinar" de SPEC-15 (mismo comportamiento determinista para las tablas, ahora con indicación opcional).
9. Tests unit con dobles: afinar solo con indicación reescribe la SQL guiando al agente (recibe la indicación + la SQL anterior); afinar solo con tablas se comporta como el antiguo "fijar" (recuperación con esa tabla); una indicación puede traer una tabla nueva por la recuperación; afinar reinicia el contador de intentos; afinar iterativo parte de la SQL anterior.

**Criterios de aceptación**

- [X] En la revisión, "Afinar" acepta una indicación en lenguaje natural y/o tablas a forzar (al menos una), y relanza el ciclo hasta volver a la revisión
- [X] La indicación llega al SQL Agent junto a la consulta anterior, y la nueva consulta intenta incorporar lo pedido en vez de generar de cero
- [X] La indicación se suma a la pregunta en la recuperación: una tabla nueva mencionada puede entrar por significado sin fijarla
- [X] El Judge evalúa contra la pregunta más las indicaciones acumuladas: no penaliza lo que el usuario acaba de pedir al afinar
- [X] Las tablas forzadas entran de forma determinista (`mustInclude`); una que no existe se avisa y se ignora
- [X] Afinar reinicia el contador de intentos del Judge; la consulta afinada tiene su propio ciclo de reintento automático (SPEC-10)
- [X] Puedo afinar varias veces seguidas, partiendo cada vez de la consulta actual
- [X] La acción "fijar tablas" de SPEC-08 queda sustituida por "Afinar" (sin perder el comportamiento determinista de las tablas)
- [X] `generateSql` ya no depende de `JudgeVerdict`: recibe `{ previousSql, instructions }`, y el pipeline decide las instrucciones (del Judge o del usuario)
- [X] Tests unit con dobles: solo indicación, solo tablas, indicación que trae tabla nueva, reinicio del contador, afinado iterativo

```bash
cd backend && npm test    # unit del afinado guiado (con dobles)
```

---

### SPEC-16 — Seguimiento conversacional de una consulta (pregunta de seguimiento)

**Objetivo.** Tras ejecutar una consulta y ver los resultados, quiero poder hacer una **pregunta de seguimiento** ligada a esa consulta ("¿y si además…?", "ahora agrúpalo por mes") sin empezar de cero, como una conversación sobre la propia consulta. Es el primer paso hacia el **análisis conversacional** (visión BI, [arquitectura.md §11](arquitectura.md)). Es distinto de "Afinar" (SPEC-15): afinar ocurre **antes** de ejecutar, sobre la consulta propuesta y para el usuario técnico que ve que algo falla; el seguimiento ocurre **después** de ejecutar, sobre los resultados que ya he visto.

**Contrato (esbozo, se detallará al implementar).**

- Tras ejecutar y mostrar los resultados, el CLI pregunta "¿quieres algo más de esta consulta?". Si no, termina y vuelve al menú. Si sí, pido la pregunta de seguimiento.
- El seguimiento arranca un nuevo ciclo del pipeline llevando como contexto la pregunta y la SQL anteriores (y, si ayuda, la forma del resultado), para que el SQL Agent construya sobre lo ya hecho en vez de partir de cero.
- Se apoya en el checkpointer que ya persiste el estado por `thread_id` (SPEC-08) y encaja con la gestión de conversaciones (SPEC-12), que da el hilo con nombre e historial.

*(Contrato completo, pasos y criterios de aceptación: se detallarán al abordar el SPEC-16.)*

---

### SPEC-17 — Prueba de escala: segunda BD objetivo grande + evaluación multi-BD

**Objetivo.** Validar con datos el argumento que hasta ahora solo defiendo de palabra: que el valor del GraphRAG **crece con el tamaño del esquema**. Arcadia tiene 17 tablas y a esa escala "volcar el esquema entero" aún cabe en el contexto. Quiero una segunda BD objetivo **grande** (~60 tablas) para enseñar que, al crecer el esquema, el contexto de "sin recuperación" se dispara (tokens, y a cierto punto ni cabe) mientras que el GraphRAG se mantiene **acotado** con un recall alto. Todo **sin tocar nada de lo que tengo**: Arcadia sigue siendo la BD por defecto.

**Decisión de la BD (D-10).** Uso una BD **sintética** grande (dominio extendido del universo de Arcadia, "plataforma de videojuegos/medios", ~60 tablas con claves foráneas reales), reproducible con `seed=42`, no una pública. Motivo: una sintética la puedo montar entera y controlada; el argumento de escala (tokens de contexto + recall) **no depende** de que la BD sea pública, y de hecho una sintética es no-contaminada (como Arcadia), lo que evita el confound de memorización. Dejo igualmente el **mecanismo de configuración** para elegir qué BD se evalúa y un **aviso de contaminación** que se mostraría si algún día conecto una BD pública real ("puede que el LLM ya la haya visto en su entrenamiento").

**Contrato.**

- *Segunda BD objetivo, no invasiva.* La BD grande se declara como `TARGET_DB_2_*` en `.env` (Arcadia sigue en `TARGET_DB_1_*`), se carga como una BD más en el mismo Postgres de Docker (su `schema.sql`), y aparece en el catálogo del CLI para consultarla igual que Arcadia. Nada de lo existente cambia; Arcadia es el defecto.
- *Elegir qué BD se evalúa.* El runner de evaluación admite una variable `EVAL_TARGET` (nombre de la BD; por defecto Arcadia) y carga el **golden set correspondiente** a esa BD (un pequeño registro nombre→fichero). El golden set de la BD grande vive en su carpeta de dataset.
- *Aislamiento y restauración.* Neo4j y pgvector son de un solo inquilín (una schema-graph y un índice, compartidos). Evaluar la BD grande exige ingerir+vectorizar **su** esquema, lo que sustituye temporalmente el de Arcadia. Por eso la prueba de escala **restaura Arcadia al terminar** (re-ingesta + re-vectorización, en `try/finally`), igual que el ablation de descripciones. Aislar por inquilín (namespace por BD en Neo4j/pgvector) queda como mejora futura.
- *Métricas de la prueba de escala.* Las principales son **tamaño de contexto** (tablas y tokens que recibiría el LLM) y **schema-linking recall** por modo (sin recuperación / solo vectorial / GraphRAG). Ambas se miden **sin datos** (tablas vacías bastan: el contexto sale del DDL y la recuperación del esquema + FKs), así que esta fase no necesita seed ni SQL de referencia. La **execution accuracy** sobre la BD grande (que sí necesita datos sembrados + SQL de referencia) queda como fase posterior.
- *Golden set de la BD grande.* ~12-15 preguntas en español con sus **tablas gold** (para el recall), varias multi-hop (JOINs que obligan a la expansión por FK). La SQL de referencia es opcional en esta fase (se añade cuando se siembren datos).

**Pasos**

1. Diseñar `setup/datasets/<grande>/schema.sql`: ~60 tablas coherentes (módulos: catálogo, contenido/DLC, clientes/suscripciones, comercio/facturación, partidas/telemetría, social, reseñas/moderación, eventos/torneos, soporte…) con FKs reales. Mantener el motivo de la tabla de nombre opaco.
2. Cargar la BD grande en Docker como una BD más (init SQL), sin tocar la carga de Arcadia.
3. Config: añadir `TARGET_DB_2_*` a `.env.example`; el catálogo (`loadTargetDatabases`) ya la recoge. Marcar en la config si una BD es pública (para el aviso de contaminación).
4. Registro golden set por BD (nombre→fichero) y `EVAL_TARGET` en el runner para elegir BD + golden set; por defecto Arcadia (comportamiento actual intacto).
5. Golden set de la BD grande (~12-15 preguntas con tablas gold).
6. Prueba de escala (script opt-in): ingerir+vectorizar la BD grande, medir recall + tamaño de contexto por modo, y **restaurar Arcadia** en `try/finally`. Sin LLM (retrieval puro), así es rápida y barata. Guardar informe en `docs/evaluacion/`.
7. Comparar Arcadia (17 tablas) vs la BD grande (~60): enseñar que el contexto de "sin recuperación" se dispara con el nº de tablas y el del GraphRAG se mantiene acotado, con recall alto.

**Criterios de aceptación**

- [X] La BD grande (66 tablas, `nebula`) se declara como `TARGET_DB_2` y se puede elegir/consultar desde el CLI, con Arcadia intacta como defecto
- [X] `EVAL_TARGET` selecciona la BD a evaluar y su golden set (registro nombre→fichero); sin ella, todo funciona como hoy (Arcadia)
- [X] La prueba de escala mide, por modo, el tamaño de contexto (tablas y tokens) y el schema-linking recall sobre la BD grande, sin necesitar datos sembrados
- [X] Al terminar, Arcadia queda restaurada en Neo4j y pgvector (verificado: mismos números que antes de la prueba)
- [X] El informe compara Arcadia (17) vs Nebula (66): "sin recuperación" 1498→5748 tokens, GraphRAG plano 774→759 con recall 99%→100% (`docs/evaluacion/escala.md`)
- [X] Existe el aviso de contaminación para BDs marcadas como públicas (`TARGET_DB_n_PUBLIC=true`); Nebula es sintética (`false`)
- [X] Nebula sembrada (seeder ligero, seed=42) y execution accuracy medida (ejecutando contra la BD evaluada, no la de por defecto — ver el bug corregido abajo): dentro de Nebula, en media de 5 tiradas, GraphRAG queda primero (72%, rango 67–80) frente al esquema entero (68%) y al vectorial solo (60%, idéntico en las cinco), con ~1/7 del contexto. Nota: accuracy no comparable directa entre BDs (golden sets distintos)
- [X] Corregido un bug de la evaluación: `makeEvaluationDependencies` ejecutaba contra la BD por defecto (Arcadia) en vez de la BD evaluada, invalidando los primeros aciertos de Nebula (un engañoso 40%); ahora conecta al `target` correcto, con test de regresión. Interpretación inclusiva de agregaciones "por categoría" en el golden set (D-13)

```bash
cd backend && npm run evaluate:scale    # prueba de escala sobre la BD grande (opt-in; ingiere/vectoriza y restaura Arcadia)
```

---

### SPEC-18 — Selección de la BD objetivo en el flujo de consulta

**Objetivo.** Poder elegir sobre QUÉ base de datos del catálogo pregunto desde "Consultar en lenguaje natural", igual que ya elijo cuál escanear. Hoy el flujo de consulta usa siempre la primera del catálogo (`TARGET_DB_1`): el dialecto, la comprobación de sintaxis del Judge y la ejecución van fijos a ella, aunque el índice tenga otro esquema.

**Contrato.**

- *Índice consciente de su BD.* Neo4j y pgvector son de un solo inquilino: contienen el esquema de la ÚLTIMA BD escaneada. Para que la selección sea segura, el índice vectorial registra **de qué BD** es (el nombre de la BD se guarda al vectorizar, junto al modelo/dimensión que ya se guardaban). `getIndexedModel` lo expone (`targetName`; `null` en índices anteriores a este cambio, que se tratan como "desconocido").
- *Selector en el flujo de consulta.* Si el catálogo tiene más de una BD, el flujo pregunta cuál consultar, marcando la que está indexada. Con una sola BD, no pregunta nada (comportamiento actual intacto).
- *Guardia de desajuste.* Si la BD elegida NO es la indexada, el flujo avisa (la recuperación devolvería tablas de otra BD) y ofrece **escanearla ahí mismo** (ingesta + vectorización con el mismo modelo del índice, mismas piezas que la prueba de escala) o cancelar. Nunca se genera SQL con un índice de otra BD sin avisar.
- *Todo el pipeline apunta a la BD elegida.* El dialecto, la comprobación de sintaxis del Judge (dry-run) y la ejecución usan la BD seleccionada, no la de por defecto. Se inyecta con el mismo patrón que `makeEvaluationDependencies` (la lección del bug de SPEC-17: nada de `connectDefault` implícito cuando hay una BD elegida).

**Pasos**

1. Registrar el nombre de la BD al vectorizar: `IEmbeddingsStore.prepare(dimensions, targetName)` y columna `target_name`; `getIndexedModel` devuelve también `targetName`.
2. `makePipelineDependencies(target)` en el grafo del pipeline: `execute` y el `checkSyntax` del Judge conectan a la BD dada vía `TargetDatabaseFactory.connect(target)`; recuperación y generación no cambian.
3. CLI: selector de BD en "Consultar" (solo si hay más de una), con la indexada marcada; guardia de desajuste con oferta de escaneo inline.
4. Tests: la vectorización guarda el nombre (doble del almacén); `makePipelineDependencies` conecta a la BD dada (regresión, mismo estilo que la de la evaluación); el guardia de desajuste no deja pasar sin escanear o cancelar.

**Criterios de aceptación**

- [X] Al vectorizar queda registrado de qué BD es el índice, y `getIndexedModel` lo expone (`targetName`; verificado que un índice anterior al cambio se lee como `null` sin romper)
- [X] Con más de una BD en el catálogo, "Consultar" deja elegir y marca la indexada; con una sola, no pregunta
- [X] Elegir una BD no indexada avisa y ofrece escanearla ahí mismo (con el modelo del índice); el pipeline nunca corre con el índice de otra BD sin aviso
- [X] Dry-run del Judge y ejecución usan la BD elegida (test de regresión: `makePipelineDependencies` conecta a la BD dada)
- [X] Suite unitaria verde, sin tocar Docker

---

### SPEC-19 — Presentación gráfica de resultados en consola

**Objetivo.** Cuando el resultado de una consulta aprobada tiene forma de "categoría → valor" (la mayoría de agregaciones del golden set), poder verlo como **gráfico de barras en la terminal**, además de (o en vez de) la tabla. La detección de si un resultado es graficable es **determinista** (una función pura sobre la forma del resultado), no cosa del LLM: gratis, instantánea y testeable — mismo criterio que el Judge (determinista donde se puede, LLM solo donde hace falta).

**Contrato.**

- *Detección pura.* `detectChart(result)` devuelve un plan de gráfico o `null`: hay gráfico si el resultado tiene entre 2 y ~30 filas, una columna de etiqueta (texto) y al menos una numérica. La primera columna de texto es la etiqueta; la primera numérica, el valor. Filas con valor nulo se muestran con `∅` y barra vacía.
- *Render puro.* `renderBarChart(result, plan)` devuelve un `string`: barras horizontales proporcionales con caracteres de bloque (`█`), etiquetas alineadas y el valor numérico al final de cada barra. Sin dependencias nuevas. Los valores ≤ 0 se muestran con barra vacía y su número (no se ocultan: un 0 es información, D-13).
- *Elección del usuario.* Tras aprobar y ejecutar, si el resultado es graficable el CLI pregunta **"¿Cómo lo muestro? Tabla / Gráfico / Ambas"**; si no lo es, muestra la tabla directamente como hasta ahora. La lógica de detección/render vive en la capa de aplicación (funciones puras); el CLI solo pregunta y pinta.

**Pasos**

1. `application/sql/resultCharting.ts`: `detectChart` y `renderBarChart` como funciones puras, con TDD (formas graficables y no graficables, nulos, ceros, negativos, empates, anchura de etiquetas).
2. CLI (`sqlPipeline.presentResult`): si hay plan de gráfico, preguntar Tabla/Gráfico/Ambas y pintar según la elección; color con chalk en la capa CLI (el render puro devuelve texto sin ANSI).
3. Documentar en la guía de uso (`docs/uso.md`).

**Criterios de aceptación**

- [X] Un resultado "categoría → valor" (p. ej. clientes por región) ofrece Tabla / Gráfico / Ambas, y el gráfico de barras se ve proporcional y legible (verificado con datos reales de Arcadia)
- [X] Un resultado no graficable (una sola fila, todo texto, demasiadas filas) muestra la tabla directamente, sin preguntar
- [X] Detección y render son funciones puras con tests (13, incluyendo nulos, ceros, negativos y numéricos-como-texto); el CLI no contiene lógica de detección
- [X] Suite unitaria verde (169 tests)

---

### SPEC-20 — Índice multi-inquilino: varias BDs indexadas a la vez 🔮 *Futuro (fuera del MVP)*

**Objetivo.** Que Neo4j y pgvector puedan contener los esquemas de **varias BDs objetivo a la vez**, cada una en su "inquilino", para cambiar de BD en la consulta sin re-escanear. Hoy son de un solo inquilino: escanear una BD reconstruye ambos almacenes y desindexa la anterior, y por eso el flujo de consulta lleva un guardián (SPEC-18) que avisa del desajuste y ofrece re-escanear. Funciona y es seguro, pero cambiar de BD cuesta un escaneo cada vez; con el multi-inquilino, el selector elegiría BD y listo.

**Contrato.**

- *pgvector por inquilino.* La columna `target_name` (ya existe desde SPEC-18) pasa de anotación a **clave de partición**: `prepare` deja de hacer `DROP TABLE` y borra solo las filas de su BD; `searchSimilar` filtra por la BD indicada. Re-escanear una BD no toca el índice de las demás. La dimensión del vector es única por tabla física: si dos BDs se vectorizan con modelos de dimensión distinta, se rechaza con un error claro (mismo modelo para todo el índice).
- *Neo4j por inquilino.* Los nodos `Table`/`Column` llevan una propiedad `target`; la ingesta borra y recrea solo los nodos de su BD, y TODAS las consultas del `SchemaGraphManager` (recuperación, expansión por FK, resumen) filtran por ella. Dos BDs con una tabla del mismo nombre no se mezclan.
- *La recuperación recibe la BD.* `retrieveSchemaContext` (y su traza de SPEC-13) reciben qué BD consultar y lo propagan a la búsqueda semántica y al grafo. El pipeline ya sabe su `target` (SPEC-18): solo hay que pasarlo hacia abajo.
- *CLI sin guardián.* El selector de BD muestra qué BDs están indexadas (puede haber varias); elegir una indexada no pregunta nada, y una no indexada ofrece escanearla (que ya no desindexa a las demás). El guardián de desajuste de SPEC-18 desaparece porque el desajuste ya no puede existir.
- *Compatibilidad.* Un índice de un solo inquilino (anterior) se migra con un re-escaneo normal; la evaluación (`EVAL_TARGET`) y la prueba de escala dejan de necesitar el baile de "ingerir → medir → restaurar Arcadia".

**Pasos**

1. pgvector: `prepare`/`upsert` por inquilino (borrado selectivo), `searchSimilar(target, …)`, y el guard de dimensión única.
2. Neo4j: propiedad `target` en nodos y relaciones; ingesta y todas las lecturas del `SchemaGraphManager` filtradas.
3. Propagar la BD por `retrieveSchemaContext`, la traza (SPEC-13) y las tools; el pipeline ya la tiene.
4. CLI: selector con varias indexadas; retirar el guardián de desajuste. Simplificar la restauración en los runners de evaluación.
5. Tests: dos BDs indexadas no se mezclan (recuperación filtrada), re-escanear una no toca la otra, dimensión distinta se rechaza.

**Criterios de aceptación**

- [ ] Dos BDs escaneadas conviven: la recuperación de cada una solo ve sus tablas (incluso con nombres repetidos)
- [ ] Re-escanear una BD no desindexa las demás
- [ ] El selector de consulta cambia de BD indexada sin re-escanear ni avisar
- [ ] Vectorizar con una dimensión distinta a la del índice se rechaza con error claro
- [ ] La prueba de escala ya no necesita restaurar Arcadia al terminar

---

### SPEC-21 — Experimento de confusión: nombres opacos casi-duplicados

**Objetivo.** El benchmark actual es amable con la baseline (sesgo #5 de `arquitectura.md` §10): los nombres de las tablas son autoexplicativos, así que "volcar el esquema entero" acierta aunque no entienda nada. Una BD de empresa real tiene familias de tablas indistinguibles por nombre (`dades_client_x`, `dades_client_y`, copias `_v2`, códigos de ERP). Este experimento reproduce esa realidad en pequeño y mide la hipótesis: **cuando el nombre no discrimina, ¿quién acierta — y cuánto rescatan las descripciones?**

**Contrato.**

- *Ofuscación reversible.* Seis tablas de Nebula, **con datos y no usadas por el golden set existente** (las 15 preguntas actuales quedan intactas), se renombran al MISMO patrón opaco para que el nombre no discrimine nada entre dominios distintos: `purchase→t_ops_01`, `refund→t_ops_02`, `gift_card→t_ops_03`, `rating→t_ops_04`, `message→t_ops_05`, `save_game→t_ops_06`. El renombrado es `ALTER TABLE … RENAME` al empezar y se **revierte siempre** al terminar (`try/finally`, las FKs sobreviven al rename); Arcadia se restaura en el índice al final, como en la prueba de escala.
- *Fase dura: columnas opacas también.* La fase 1 demostró que renombrar solo la tabla NO basta para confundir al sistema: las columnas (`purchase_date`, `balance`, `sender_id`…) delatan el propósito y el recall aguantó ~100% sin descripciones. La fase dura renombra además las **columnas a c1..c5** (el mismo patrón en las seis tablas, como un ERP legacy): sin descripciones no habla nada — ni nombre ni columnas —; quedan los **tipos de dato** y las **claves foráneas** (estructura, que es lo que usa el grafo y sobrevive a los renombres). La descripción de la condición "con" **mapea las columnas** (`c5 = importe pagado`), como documentaría un *data steward* una tabla legacy real: es el caso donde la documentación no es una ayuda sino la ÚNICA fuente semántica. La motivación es el caso de coste alto (BD sanitaria/química/financiera): confundir una tabla ambigua no puede depender de la suerte, y el experimento mide qué capa lo evita.
- *Mini golden set propio.* 4-6 preguntas (C-01..C-06) que SOLO se responden con las tablas ofuscadas, en su propio fichero (`golden_confusion.yaml`, mismo formato de siempre), con la SQL de referencia sobre los nombres ofuscados. Al menos dos multi-hop (JOIN con `customer`/`game`) para medir el rescate por FK del grafo, el mecanismo que salvó a `t_042`.
- *Condiciones.* 2×3: descripciones {con, sin} × modo {sin recuperación, solo vectorial, GraphRAG}. Las descripciones de las tablas ofuscadas viven en el runner (un mapa inline, no hace falta fichero) y afectan a las dos vías, como en el ablation de SPEC-11: al índice vectorial (re-vectorización por condición) y al DDL que ve el SQL Agent.
- *Métricas.* Las de siempre sobre el subconjunto: schema-linking recall (¿aparece la tabla ofuscada?), execution accuracy justa y equivalencia semántica. El informe (`docs/evaluacion/confusion.md`) desglosa POR CASO qué tabla se recuperó y por qué vía, porque con 4-6 casos el detalle vale más que el agregado.
- *Hipótesis declarada (antes de medir).* Sin descripciones, todos los modos sufren — incluida la baseline "esquema entero", porque el nombre ya no le dice qué tabla usar (como mucho la salvan las columnas). Con descripciones, la recuperación se recupera; y en las preguntas multi-hop el grafo puede rescatar la tabla opaca por FK incluso sin descripción. Si la baseline NO sufre, también es un resultado (las columnas bastan como pista) y se reporta igual.

**Pasos**

1. `setup/datasets/nebula/golden_confusion.yaml` con los casos C-01..C-06 (referencias sobre nombres ofuscados, interpretación D-13 donde aplique).
2. Runner opt-in `npm run evaluate:confusion`: renombrar (con guardas si ya está renombrado a medias) → por condición de descripciones: ingesta+vectorización de Nebula y evaluación del subconjunto en los tres modos → revertir renombres y restaurar Arcadia en `finally`.
3. Informe en consola + `docs/evaluacion/confusion.md` (tabla 2×3 + detalle por caso), y la lectura en `arquitectura.md` §10 junto al sesgo #5 que motiva el experimento.

**Criterios de aceptación**

- [X] Las 6 tablas se renombran y SIEMPRE se revierten (incluso si la evaluación falla); Nebula queda idéntica y Arcadia restaurada en el índice (verificado tras la ejecución)
- [X] El golden set existente de Nebula (N-01..N-15) no se ve afectado (ninguna de sus tablas se toca)
- [X] El informe muestra la matriz 2×3 con recall, justa y equivalencia, y el detalle por caso (`docs/evaluacion/confusion.md`)
- [X] La lectura honesta queda en `arquitectura.md` §10. **Fase 1** (solo tabla opaca): hipótesis parcialmente refutada — el recall aguantó ~100% sin descripciones porque las COLUMNAS delatan el propósito y la vectorización las incluye. **Fase dura** (tabla + columnas c1..c5 opacas): hipótesis confirmada — sin descripciones se hunden todos los modos (vectorial 8% recall, GraphRAG 17%, y el esquema ENTERO solo 17-33% de equivalencia: verlo todo no sirve si nada habla), el rescate por FK solo no basta (la tabla opaca pierde el sitio del recorte de contexto frente a vecinas con score), y el resultado central: **las descripciones solo funcionan con recuperación** — GraphRAG+descripciones 83% de equivalencia y 100% de recall, mientras el esquema entero con las MISMAS descripciones en el DDL se queda en 17% (la documentación ahogada entre 66 tablas no es usable; la recuperación la hace visible)

---

### SPEC-22 — Relaciones sintéticas en Neo4j: aristas curadas para BDs sin FKs declaradas 🔮 *Futuro (fuera del MVP)*

**Objetivo.** Que el grafo pueda contener relaciones entre tablas que **no existen como clave foránea** en el DDL de la BD objetivo, declaradas aparte por quien conoce el dominio. El caso que lo motiva es real: un ERP viejo **sin ninguna FK declarada**, cuyo esquema no puedo tocar —es de un tercero y crear FKs cambiaría la BD productiva—, pero cuyas relaciones entre algunas tablas sí conozco. Hoy la expansión por FK del GraphRAG (SPEC-04) no tiene nada que expandir en una BD así: la recuperación se queda en las tablas que casan por significado y no arrastra las del JOIN, y el SQL Agent tiene que **adivinar** cómo unir. Con relaciones sintéticas, declaro esas uniones una vez en un fichero, viven **solo en Neo4j** (nunca escribo en la BD objetivo) y el sistema las usa igual que las FK reales: para traer las tablas relacionadas y para saber por qué columnas unirlas.

Dos motivos más se sumaron después. La auditoría de la evaluación (2026-07-09) documentó el déficit real G-21: una tabla necesaria (`genre`) queda a **dos saltos** de las candidatas semánticas y la expansión de un salto no la alcanza — una relación sintética curada acorta ese camino sin tocar la profundidad de expansión (que queda como alternativa a valorar dentro de esta spec). Y el primer uso real descubrió un valor lateral: los técnicos usan el grafo de Neo4j como **banco de pruebas del esquema** — ensayar una relación aquí y ver su efecto en la recuperación *antes* de decidir si se implementa como FK real en la BD propia; las relaciones sintéticas convierten ese ensayo en flujo soportado.

**Contrato.**

- *Sidecar de relaciones (mismo patrón que las descripciones).* Fichero(s) JSON en `relations/` con un array de `{ fromTable, fromColumn, toTable, toColumn, note? }`; los `*.example.json` se ignoran, como en `descriptions/`. Es metadata **curada por un humano** que conoce el dominio, no inferida.
- *Nunca se escribe en la BD objetivo.* Las relaciones viven SOLO en el grafo Neo4j; el DDL del tercero no se toca. Es la razón de ser del componente (no puedo/quiero añadir FKs reales), y a la vez lo hace seguro: es metadata puramente aditiva sobre el índice, no una migración de la BD productiva.
- *Aristas marcadas con procedencia.* Se crean como `REFERENCES` con una propiedad `synthetic: true`, para que la traza de recuperación (SPEC-13) y el DDL puedan señalar que esa relación es **curada**, no declarada por la BD. Misma filosofía de transparencia que el `assumed` del Judge (SPEC-14) y las fuentes de descripción: el sistema no disimula de dónde sale una relación.
- *La expansión las usa sin cambios.* La expansión por FK (`SchemaGraphManager.getNeighbors` / `expandByForeignKeys`) ya recorre `:REFERENCES` sin mirar sus propiedades, así que una arista sintética se expande igual que una real; basta con que la ingesta las cree junto a las declaradas.
- *El SQL Agent sabe unir.* La relación sintética entra en el DDL del contexto (`SchemaContext`) —como línea de FK o como comentario "relación curada: a.x = b.y"— para que el generador escriba el JOIN correcto. Es el aporte doble: mejora la **recuperación** (qué tablas) y la **generación** (cómo unirlas), algo que volcar el DDL entero no da si la relación no está documentada.
- *Sincronizadas con el escaneo.* Como las descripciones (escaneo atómico Neo4j + pgvector), las relaciones sintéticas se aplican al ingerir y re-escanear las reconstruye. No tocan pgvector (son estructura, no texto de búsqueda).
- *Guardas de validez.* Una relación cuyas tablas o columnas no existen en el esquema escaneado se **rechaza con aviso claro**, sin crear aristas colgantes. Una relación sintética errónea arrastra tablas equivocadas y baja la precisión, así que la procedencia y la curación humana son la defensa; no hay inferencia automática (un heurístico `X_id`→tabla `X` podría en el futuro *sugerir* candidatas a revisar, nunca aplicarlas solo).

**Pasos**

1. Carga del sidecar `relations/` (parseo + validación de forma), análoga a `descriptions.ts`.
2. Ingesta: al volcar el grafo, crear las aristas `REFERENCES { synthetic: true, from_column, to_column }` además de las reales, validando que las tablas y columnas existen.
3. Contexto/DDL: incluir las relaciones sintéticas en `SchemaContext` (marcadas como curadas) para que el SQL Agent las use en el JOIN.
4. Traza (SPEC-13) y Judge (SPEC-14): señalar cuándo una tabla entra por una relación sintética y cuándo un JOIN se apoya en una relación curada (aviso, no bloqueo).
5. Tests: una relación válida crea la arista y la expansión la sigue; una con tabla/columna inexistente se rechaza; la BD objetivo no recibe ninguna escritura (verificado con doble).

**Criterios de aceptación**

- [ ] Una relación declarada en el sidecar se convierte en arista en Neo4j y la expansión por FK trae la tabla relacionada aunque no haya FK en el DDL
- [ ] La BD objetivo no se modifica en ningún momento (las relaciones viven solo en Neo4j)
- [ ] La traza de recuperación distingue una relación curada de una FK real
- [ ] El SQL Agent genera el JOIN correcto apoyándose en una relación sintética
- [ ] Una relación con tabla o columna inexistente se rechaza con un mensaje claro, sin aristas colgantes
- [ ] Re-escanear reconstruye las relaciones sintéticas junto al resto del grafo

---

### SPEC-23 — Plantillas parametrizadas: consultas aprobadas reutilizables con parámetros tipados 🔮 *Futuro (fuera del MVP)*

**Objetivo.** Una consulta aprobada resuelve una pregunta concreta ("ventas del cliente 42 en junio"), pero el patrón se repite con otros valores. Quiero poder guardar una consulta aprobada como **plantilla**: sus literales del `WHERE`/`HAVING` se convierten en parámetros con nombre y tipo, y cualquier usuario la relanza con valores nuevos sin pasar por el LLM ni por una nueva aprobación — la estructura ya la validó un humano; lo único que cambia son valores, y van **siempre ligados**. Nace de una petición de los primeros usuarios (reproducir consultas favoritas —SPEC-25— con datos actualizados) y es el puente entre el almacén de guardadas (SPEC-09, D-15), las favoritas (SPEC-25) y los widgets (SPEC-24).

**Contrato.**

- *Parametrización asistida, una sola vez.* Al guardar como plantilla, el LLM propone qué literales convertir en parámetros (nombre legible, tipo, valor de ejemplo) y el usuario confirma o ajusta. El tipo sale del esquema real (la columna comparada, vía el grafo), no de una adivinación.
- *Solo VALORES, nunca estructura con texto libre.* Los parámetros son valores de `WHERE`/`HAVING` (y `LIMIT`); la ejecución usa placeholders con valores ligados por el driver → inyección imposible por construcción. La estructura (`SELECT`/`JOIN`/`GROUP BY`) queda congelada tal como se aprobó.
- *Variantes de estructura por allowlist.* SQL no permite ligar nombres de columna como parámetros; si una plantilla necesita variar el eje ("por mes / por delegación"), cada variante es una estructura **pre-aprobada** y el usuario elige de una lista cerrada. Nunca se sustituye un identificador con texto del usuario.
- *Ejecución sin LLM.* Relanzar una plantilla = pedir los valores (validados por tipo) + ejecutar en solo lectura + presentar (tabla/gráfico, SPEC-19). Coste LLM cero, latencia la de la query.
- *El Judge determinista sigue de guardia.* La sentencia final pasa igualmente la Capa 1 (allowlist de solo lectura): es barata y no negociable, aunque la estructura esté aprobada.
- *Almacén compartido con SPEC-09*: la tabla de consultas aprobadas gana los campos de plantilla (SQL con placeholders, parámetros tipados con default, variantes), detrás del mismo puerto.

**Pasos**

1. Modelo de dominio de la plantilla: SQL con placeholders, lista de parámetros `{ nombre, tipo, default }`, variantes opcionales.
2. Caso de uso "guardar como plantilla" (deps inyectadas): el LLM propone la parametrización, el usuario la confirma en el CLI.
3. Caso de uso "ejecutar plantilla": validar tipos → ligar valores → Capa 1 → ejecutar en solo lectura.
4. CLI: listar plantillas (por BD objetivo), elegir, rellenar parámetros con validación, presentar el resultado.
5. Variantes por allowlist (cada una con su SQL pre-aprobada).
6. Tests con dobles: bind correcto, valor de tipo inválido rechazado antes de ejecutar, la estructura no es editable en la ejecución, la Capa 1 se aplica siempre.

**Criterios de aceptación**

- [ ] Guardar una consulta aprobada como plantilla propone parámetros con nombre y tipo, y el usuario los confirma
- [ ] Ejecutar una plantilla pide los valores, los valida por tipo y ejecuta con parámetros ligados (nunca interpolación de texto en la SQL)
- [ ] Un valor de tipo incorrecto se rechaza con un mensaje claro antes de tocar la BD
- [ ] La estructura aprobada no cambia; las variantes de agrupación solo salen de la allowlist pre-aprobada
- [ ] La ejecución de una plantilla no llama a ningún LLM y pasa la capa determinista del Judge
- [ ] Suite unitaria verde con dobles, sin Docker ni LLM

---

### SPEC-24 — Widgets bajo demanda: SQL aprobada ejecutada sin LLM para dashboards 🔮 *Futuro (fuera del MVP)*

**Objetivo.** El caso de uso que piden las primeras empresas interesadas: estadísticas en tiempo (casi) real para usuarios de un ERP, como widgets o dashboards bajo demanda. La pieza clave es económica y de seguridad a la vez: el LLM (el pipeline completo, con revisión humana) solo interviene al **crear** el widget; cada refresco ejecuta directamente la SQL aprobada (o la plantilla de SPEC-23 con sus valores) — coste LLM cero por refresco, latencia la de la query, y solo se ejecuta estructura que un humano aprobó. El coste crece con los widgets que la gente crea, no con las veces que se miran.

**Contrato.**

- *Un widget es*: una consulta aprobada o plantilla (SPEC-23) + valores por defecto + una presentación (tabla / gráfico de barras, SPEC-19) + metadatos (nombre, BD objetivo, fecha).
- *Crear desde la revisión*: tras aprobar y ejecutar una consulta, una acción "guardar como widget" (nombre + presentación). También desde una plantilla existente.
- *Refrescar sin LLM*: ejecutar el widget repite la consulta por la misma vía que SPEC-23 (valores ligados, Capa 1, solo lectura, timeout y tope de filas) y repinta la presentación.
- *Primera entrega en el CLI*: una opción "mis widgets" que lista, ejecuta y pinta. La exposición a un ERP externo (API HTTP o servidor MCP sobre las tools existentes, D-12) queda **explícitamente fuera** de esta spec y ligada a esa dirección futura; aquí se deja la lógica desacoplada de la presentación para que ese salto sea pequeño.
- *Gestión mínima*: renombrar y borrar; sin permisos ni compartición entre usuarios en esta fase.

**Pasos**

1. Modelo de dominio del widget (consulta/plantilla + presentación + metadatos) y su almacén en `graphsql_memory` (puerto + adaptador + factory, D-05).
2. Acción "guardar como widget" en la revisión humana y sobre plantillas.
3. Caso de uso "ejecutar widget" reutilizando la ejecución de SPEC-23; presentación con SPEC-19.
4. CLI: listar/ejecutar/renombrar/borrar.
5. Tests con dobles: crear desde una aprobación, refrescar no llama al LLM, borrar no afecta a la consulta aprobada origen.

**Criterios de aceptación**

- [ ] Tras aprobar una consulta puedo guardarla como widget con nombre y presentación
- [ ] Ejecutar un widget no llama a ningún LLM y respeta solo lectura, timeout y tope de filas
- [ ] El widget de una plantilla pide (o usa por defecto) sus parámetros tipados
- [ ] Puedo listar, renombrar y borrar widgets desde el CLI sin afectar a las consultas aprobadas de origen
- [ ] Suite unitaria verde con dobles, sin Docker ni LLM

---

### SPEC-25 — Consultas favoritas: guardar con nombre, listar y reejecutar sin agentes 🔮 *Futuro (fuera del MVP)*

**Objetivo.** Que una consulta que me funciona la pueda **guardar con un nombre** y, otro día, **recuperarla y reejecutarla directamente** — sin pasar por la recuperación, la generación, el Judge LLM ni el bucle de revisión. Es el uso "día a día" que no necesita a los agentes: preguntas recurrentes (los ingresos del mes, los clientes activos) que ya resolví una vez y solo quiero volver a lanzar. Comparte la tabla y el momento de guardado con la memoria *few-shot* (SPEC-09): la decisión de una sola tabla con flags está en **D-15**.

**Contrato.**

- *Guardar como favorita (mismo momento que SPEC-09).* Tras presentar el resultado, además de "marcar como ejemplo" (SPEC-09) puedo **guardarla como favorita con un título**: marca `is_favorite = true` y rellena `title` en la misma fila de `saved_queries`. Los dos flags son independientes: una consulta puede ser favorita, ejemplo, las dos o ninguna. Guardar es no crítico (la consulta ya se ejecutó): un fallo solo avisa.
- *Listar.* El CLI ofrece "Consultas favoritas": lista las favoritas de la BD objetivo elegida (título, fecha, un extracto de la SQL), ordenadas por fecha o título. Es una vista **cara al usuario**, por título, no por similitud (eso es la memoria).
- *Reejecutar sin agentes, PERO con la barrera de seguridad.* Elegir una favorita salta la recuperación, la generación y el Judge LLM — pero **no** la Capa 1 de seguridad de SPEC-06 (allowlist `SELECT`/`WITH`, keywords peligrosas, patrones de inyección: determinista y barata) ni el modo solo-lectura: la SQL guardada fue buena una vez, pero la BD pudo cambiar y la defensa en profundidad es innegociable. Flujo: elegir favorita → **check de seguridad** → ejecutar en solo-lectura contra su BD → presentar con el `presentResult` que ya existe (tabla/gráfico, SPEC-19). Si el check falla (o la ejecución da error porque el esquema cambió), aviso claro y no ejecuto.
- *Gestionar.* Puedo **renombrar** y **borrar** favoritas desde el CLI. Borrar una fila que también es ejemplo (`use_as_example`) solo debería quitarla de favoritas si sigue sirviendo a la memoria — o borrar la fila entera con aviso; lo resuelvo como quitar el flag `is_favorite` y borrar la fila solo si ningún flag queda activo.
- *Fuera de alcance en esta fase.* Parametrizar la consulta al reejecutar ("lo mismo pero del mes pasado", "para el cliente X") es exactamente **SPEC-23 (plantillas parametrizadas)**, que construye sobre esta pieza; aquí se reejecuta **literal**. El por-usuario también es futuro (la columna `user_id` de D-15 ya lo prevé; hoy, un valor por defecto).

**Pasos**

1. Reutilizar la tabla/puerto/adaptador/factory `saved_queries` de SPEC-09 (D-05, D-15): añadir al puerto `listFavorites(target)`, `get(id)`, `rename(id, title)`, `delete(id)`.
2. Caso de uso `runSavedQuery(id, deps)`: recupera la fila, pasa la SQL por la Capa 1 de seguridad (servicio de dominio puro de SPEC-06) y, si pasa, la ejecuta en solo-lectura contra su BD objetivo (`executeQuery`, SPEC-07). Deps inyectadas con reales por defecto.
3. CLI: en el guardado tras el resultado, opción "guardar como favorita" con título; nueva entrada de menú "Consultas favoritas" que lista, reejecuta (reusando `presentResult`), renombra y borra.
4. Tests con dobles: reejecutar pasa siempre por la barrera de seguridad; una SQL que hoy no la pasaría no se ejecuta; listar filtra por BD y `is_favorite`; renombrar y borrar; guardar como favorita marca el flag y el título sin tocar `use_as_example`.

**Criterios de aceptación**

- [ ] Tras ver el resultado puedo guardar la consulta como favorita con un título; los flags favorita/ejemplo son independientes
- [ ] El CLI lista mis favoritas de la BD elegida (título + fecha + extracto), y puedo elegir una y reejecutarla
- [ ] La reejecución salta recuperación/generación/Judge LLM pero **pasa por la Capa 1 de seguridad** y el modo solo-lectura antes de ejecutar; si no la pasa, no se ejecuta
- [ ] El resultado se presenta con el mismo render de SPEC-19 (tabla / gráfico)
- [ ] Puedo renombrar y borrar favoritas; borrar respeta que la fila pueda seguir siendo ejemplo de la memoria
- [ ] Suite unitaria verde con dobles, sin Docker ni LLM

```bash
cd backend && npm test    # unit de listar/reejecutar/renombrar/borrar favoritas (con dobles)
```

---

### SPEC-26 — Recuperación por capas para esquemas grandes ✅ *Hecho*

**Objetivo.** Que la recuperación siga trayendo el contexto correcto cuando el esquema es grande, opaco y sin documentar (un ERP real de ~800 tablas), donde el top-K vectorial de SPEC-04 se rompe: el sustantivo por el que se pregunta ("abonado") queda enterrado bajo decenas de tablas del tema dominante de la frase. La similitud mide el *tema*, no el *papel* de la tabla; hacen falta capas que aporten recall léxico, recall estructural (grafo) y precisión por razonamiento (LLM). Todo detrás de palancas, para que el *ablation* del golden set (SPEC-11) siga midiendo SPEC-04 puro y las métricas sean comparables.

**Contrato.**

- *Palancas en `SchemaRetrievalOptions` (todas por defecto en el valor histórico).* `lexical` (híbrido on/off), `expansionMode` (`neighbors` | `paths`), `useSelector` (selector LLM on/off), `maxPathLength`. El pipeline en vivo las activa; el arnés de evaluación usa los defaults.
- *Ranking híbrido.* Fusión por *Reciprocal Rank Fusion* del ranking denso (pgvector) y uno léxico (coincidencia por trigramas de las palabras de la pregunta con nombre y columnas). El score fusionado gobierna candidatas top-K y desempates.
- *Expansión por grafo.* Además de las vecinas a un salto (SPEC-04): **conectores** (tablas en el camino de FK más corto entre dos anclas) y **destinos de FK** de las anclas (sus dimensiones). Selección final por presupuesto acotado (`maxTables`) con prioridad estricta: fijadas > top-K > conectores > destinos FK > resto; el rescate estructural nunca expulsa a las candidatas semánticas.
- *Selección con LLM.* Sobre un pool acotado (~`SELECTOR_POOL_SIZE`), un agente elige las tablas por razonamiento y devuelve solo nombres del pool (no inventa). Su selección se completa por grafo (destinos FK + conectores) para cerrar los JOIN. Las fijadas (SPEC-08) se unen siempre a la selección, elija lo que elija el LLM. Si no elige nada válido o el LLM falla (excepción incluida), se cae al recorte por score: el selector es una mejora, nunca un punto único de fallo.
- *Doble modelo por rol.* `ChatModelFactory.fromEnv(role)` con `reasoning` (selector) y `generation` (generador + juez + equivalencia), cada uno con su variable de entorno y caída al modelo base. Documentado en arquitectura §6.
- *Explicabilidad.* La traza (SPEC-13) distingue los motivos nuevos (conector / destino FK / elegida por el LLM) y el modo depuración imprime el DDL final.

**Pasos** *(implementados)*

1. `hybridRanking.ts`: tokenización, similitud de trigramas, ranking léxico y fusión RRF (funciones puras).
2. `SchemaGraphManager.getConnectingTables` (caminos de FK) y cálculo de destinos-FK desde la metadata ya recuperada.
3. `schemaRetrieval.ts`: palancas, fusión, selección por prioridad, pool y completado; `schemaSelection.ts` (agente + `agents/schema-selector.md`).
4. `modelSelection.ts` + adaptadores/factory para el doble modelo por rol.
5. Pipeline en vivo y modo depuración activan híbrido + caminos + selector; el arnés de evaluación no.
6. Tests unitarios con dobles de cada pieza (fusión, caminos, destinos-FK, selector, resolución de modelo por rol).

**Criterios de aceptación**

- [x] Con las palancas por defecto, la recuperación es idéntica a SPEC-04 (métricas del golden set intactas)
- [x] En modo híbrido, una tabla léxicamente cercana a la pregunta que el denso entierra entra como candidata
- [x] Los conectores y destinos de FK entran sin ser expulsados por el recorte, y las candidatas semánticas no se pierden
- [x] El selector elige solo tablas del pool; si no elige nada válido o el LLM lanza una excepción, se cae al recorte por score
- [x] Una tabla fijada (SPEC-08) entra en el contexto aunque el selector no la elija
- [x] Dos modelos por rol configurables, con caída al modelo base si no se especifican
- [x] La traza y el modo depuración muestran el motivo de cada tabla y el DDL final
- [x] Suite unitaria verde con dobles, sin Docker ni LLM

---

### SPEC-27 — Generador automático de descripciones de tabla ✅ *Hecho*

**Objetivo.** La medición sobre el ERP real de ~800 tablas (SPEC-26) deja claro que en esquemas grandes sin documentar el techo de la recuperación es la **descripción de tabla**: con una frase de descripción, una tabla sube del puesto ~60 al top del ranking (medido, antes/después). Describir 800 tablas a mano no es viable, así que quiero un generador que, dado el esquema ya escaneado (columnas y FKs reales en Neo4j), redacte con un LLM una descripción por tabla y la deje en `descriptions/<bd>.json`, de donde el escaneo ya la recoge (no toca la vectorización, que ya sabe embeber descripciones). Es a la vez la palanca que cierra el problema del ERP real y un artefacto del TFM (auto-documentación de esquema para NL2SQL).

**Contrato.**

- *Entrada.* Una BD objetivo del catálogo. El esquema se lee **en vivo** de la propia BD (no hace falta índice previo), así que sirve igual para documentar una BD que aún no se ha escaneado.
- *Por cada tabla.* Nombre + columnas (tipo, `NOT NULL`, marca de PK y de FK con su destino) y, si se autoriza, una **muestra de las 10 primeras filas**. Pido al **modelo de razonamiento** (rol `reasoning`, SPEC-26) una descripción de UNA frase centrada en el propósito de negocio (qué representa cada fila y para qué sirve), no un volcado de columnas. Cada tabla es una llamada independiente: no acumulo contexto entre tablas, así el prompt se mantiene pequeño y no se contaminan entre sí.
- *Guardarraíl de privacidad.* La muestra son datos REALES. Con LLM **local** se incluye sin fricción (no sale de la máquina). Con LLM **remoto** exijo consentimiento explícito antes de enviarla, avisando de que se mandan las 10 primeras filas de cada tabla a un tercero y de que conviene revisar la política de protección de datos; si se declina, ofrezco generar solo con nombre y columnas, o cancelar. Todo el flujo es **opt-in**: nada de esto ocurre si no se elige la opción.
- *Contexto de negocio opcional.* Una frase del usuario ("ERP de distribución mayorista B2B") que se inyecta en el prompt para orientar al modelo cuando los nombres son opacos.
- *Salida.* `descriptions/<bd>.json` (`[{tableName, description}]`), el mismo formato que ya consume el escaneo; las descripciones vacías no se escriben. Al terminar ofrezco lanzar el escaneo para vectorizarlas (con índice previo, el incremental de SPEC-29).
- *Aislamiento de fallos.* Una tabla que falle —al muestrear o al llamar al modelo— se queda sin descripción y **no aborta el resto** ni tira lo ya generado.
- *Prompt externo.* `agents/describe-tables.md`, con hueco `{{businessContext}}` (mismo patrón que los demás agentes).
- *Caso de uso testable (D-05).* `generateDescriptions(target, options, deps)` con deps inyectadas (leer esquema, leer muestras, chat, progreso); reales por defecto, dobles en los tests.
- *Fuera de alcance.* Elegir un subconjunto de tablas (por conectividad o lista blanca); fusionar con descripciones escritas a mano (hoy el fichero de esa BD se reescribe); previsualizar y editar antes de guardar; describir columnas; paralelizar. Todo ello queda en el backlog.

**Pasos**

1. `sampleTableRows`: `SELECT *` capado por motor (`fetchCapped`) con el identificador citado según dialecto; la conexión es la de solo lectura de siempre.
2. `describeTablesPrompt`: funciones puras para las columnas, la muestra y la limpieza de la respuesta. Los valores de la muestra se normalizan antes de serializar (Buffer → marcador corto, bigint → texto, también anidados; `Date` y demás instancias intactas).
3. Caso de uso `generateDescriptions` con deps inyectadas y progreso por tabla.
4. `saveDescriptions` + `descriptionsFilePathFor` en `config/descriptions.ts`.
5. Flujo de CLI con el guardarraíl, el contexto de negocio y el puente al escaneo; su opción en el menú principal.
6. Tests con dobles y documentación en `docs/uso.md`.

**Criterios de aceptación**

- [X] Genera `descriptions/<bd>.json` a partir del esquema real y, si se autoriza, de una muestra de filas (verificado en vivo sobre Meridian: 41/41 tablas con el modelo local)
- [X] Usa el modelo de rol `reasoning` (SPEC-26) y enseña cuál va a usar antes de lanzar
- [X] Con LLM remoto no se envía ninguna muestra sin consentimiento explícito; declinarlo deja generar solo con nombre y columnas
- [X] Un fallo en una tabla (muestra o modelo) no aborta el resto
- [X] La muestra no rompe la serialización (Buffer, bigint, anidados) ni vuelca binario en el prompt
- [X] El fichero generado lo recoge el mismo cargador que usa el escaneo (verificado: `loadDescriptions()` lo fusiona con las de las demás BDs)
- [X] Suite unitaria verde con dobles, sin Docker ni LLM (246 tests)

```bash
cd backend && npm test    # unit del generador (con dobles de esquema, muestra y LLM)
```

---

### SPEC-28 — Arranque guiado del CLI: preflight de infraestructura y primera vez sin índice ✅ *Hecho*

**Objetivo.** Que `npm start` sea el único comando que necesita alguien que no sabe Docker, y que la primera vez el propio CLI le marque el camino. En las pruebas de usuario del circuito completo salieron dos fricciones: (1) tras `docker compose up` el log no da ninguna señal clara de "ya puedes usar el CLI" (el init de Postgres imprime paradas y arranques que parecen errores, y los checkpoints periódicos parecen actividad), y si los contenedores no están levantados el CLI muere con un stack trace de conexión; (2) con la infraestructura lista pero **sin el esquema escaneado ni vectorizado**, el menú deja entrar a "Consultar" y "Depurar", que solo pueden fallar con un error que un usuario nuevo no sabe interpretar. El arranque debe comprobar la infraestructura y el índice, y **guiar** al usuario para dejarlos listos, en vez de suponer que ya lo están.

**Contrato.**

- *Comprobación en dos niveles.* Primero el daemon (`docker info`): si Docker no está en marcha, aviso con instrucciones (abrir Docker Desktop, enlace de instalación) y bucle de "¿lo compruebo otra vez?" para seguir sin relanzar nada. Después los contenedores (`docker inspect` sobre los nombres fijos del compose) exigiendo `running healthy`, distinguiendo "no existen todavía" de "existen pero no están listos" (y en ese caso, mostrando el estado de cada uno).
- *Oferta de creación, nunca acción silenciosa.* Si faltan contenedores, el CLI pregunta antes de tocar nada. Si acepto, ejecuta `docker compose up -d --wait postgres neo4j` heredando la salida de Docker (veo descargas y healthchecks reales), pinta un banner de *Infraestructura lista* y pregunta si arranco la aplicación. Si declino cualquier paso, sale limpio dejando impresa la instrucción manual equivalente.
- *Camino feliz silencioso.* Con todo `healthy`, una sola línea de confirmación y directo al selector de proveedor: cero preguntas redundantes en el uso diario.
- *Healthchecks como fuente de verdad.* La señal de "listo" son los healthchecks del compose, compartidos por el preflight y el arranque manual (`docker compose up -d --wait`). El de Postgres fuerza TCP (`pg_isready -h localhost`) para no dar `healthy` durante el servidor temporal del init del primer arranque, y ambos llevan `start_period` que cubre ese primer init completo (crear las BDs y cargar Arcadia y Nebula tarda ~2 min; medido, con margen ~2×): sin él, los fallos del check durante la carga marcan el contenedor `unhealthy` y el `--wait` aborta a mitad del init.
- *El arranque manual sigue siendo de primera.* Nada del preflight es obligatorio: levantar la infraestructura con `docker compose up -d --wait` y entrar al CLI se comporta exactamente igual (camino feliz).
- *"Healthy" significa init COMPLETO, no servidor que responde.* El caso que lo exige salió de una prueba de usuario: un primer init interrumpido (Ctrl+C durante la carga) deja el volumen a medias y Postgres nunca reintenta los scripts — el servidor responde pero las BDs de prueba no existen, sin ningún error. Por eso `01-init.sh` crea un **marcador** (`setup_init_complete`) al terminar TODO, y el healthcheck lo exige: un init a medias queda `unhealthy` y visible. El preflight detecta ese estado (contenedor corriendo sin marcador), lo explica, y ofrece el **reset guiado** (`down -v` + arranque completo) — destructivo solo para datos autogenerados, y siempre preguntando.
- *Menú consciente del índice (primera vez).* Antes de pintar el menú, el CLI comprueba si existe el índice vectorial (`getIndexedModel`, ya existente de SPEC-18). Si no existe: aviso de qué falta y por qué, "Escanear el esquema" pasa a la primera posición con la marca *← empieza por aquí (primera vez)*, y "Consultar" y "Depurar" quedan **deshabilitadas y no seleccionables** con el motivo a la vista (*— necesita el esquema escaneado y vectorizado*). Tras escanear, el menú vuelve solo a la normalidad (se re-comprueba en cada vuelta al menú). Si el estado no se puede comprobar (pgvector inaccesible), **no se bloquea nada**: mejor un error honesto al usar la opción que un cerrojo en falso.

**Pasos**

1. Healthchecks del `docker-compose.yml`: TCP en Postgres, intervalos cortos (5s) con más reintentos para no retrasar la señal de listo.
2. `cli/startup/infraPreflight.ts` con `ensureInfrastructureReady(): Promise<boolean>`: daemon → contenedores → oferta de `compose up` → banner → confirmación de arranque.
3. Engancharlo en `cli/main.ts` antes del selector de proveedor; si devuelve `false`, despedida limpia.
4. `cli/mainMenu.ts`: `buildMainMenuChoices(hasIndex)` como función pura (testable sin terminal) y `checkVectorIndexExists()` con los tres estados (sí / no / no se sabe); el menú de `main.ts` los usa en cada vuelta.
5. Documentar los **dos sistemas de arranque** (guiado y manual): README (puesta en marcha en 3 pasos), `instalacion.md` §3 (las dos vías) y `uso.md` (§0, §1, chuleta de comandos y problemas frecuentes).

**Criterios de aceptación**

- [X] Con la infraestructura `healthy`, `npm start` muestra `✔ Infraestructura lista` y sigue sin preguntar nada
- [X] Con contenedores parados o inexistentes, muestra el estado de cada uno y se ofrece a levantarlos; al aceptar, corre `compose up -d --wait` con progreso visible, banner y pregunta de arranque (verificado en vivo parando los contenedores)
- [X] Con Docker apagado, avisa con instrucciones y permite reintentar; nunca un stack trace
- [X] Declinar cualquier paso sale limpio con la instrucción manual impresa
- [X] El arranque manual (`docker compose up -d --wait`) sigue funcionando igual, sin servicios extra en el compose
- [X] Un primer init interrumpido deja el contenedor `unhealthy` (no "sano sin datos"), y el preflight lo diagnostica y ofrece el reset guiado que lo deja funcional (verificado en vivo matando el contenedor a mitad de la carga y recuperándolo desde el CLI)
- [X] Sin índice vectorial, el menú avisa, pone "Escanear" primero marcado y no deja seleccionar "Consultar" ni "Depurar" (motivo visible); tras escanear, el menú vuelve a la normalidad sin reiniciar (verificado en vivo ocultando la tabla del índice)
- [X] Si el estado del índice no se puede comprobar, el menú no bloquea nada
- [X] `buildMainMenuChoices` probada como función pura (los tres estados)
- [X] Suite unitaria verde (223 tests)

```bash
cd backend && npm start   # con y sin los contenedores levantados; con y sin índice
```

---

### SPEC-29 — Actualización incremental de descripciones (re-vectorización acotada) ✅ *Hecho*

**Objetivo.** Hoy cualquier cambio en `descriptions/*.json` obliga a un escaneo completo: `prepare()` tira la tabla de embeddings y se re-vectoriza TODO el esquema, aunque solo haya cambiado la descripción de una tabla. En Arcadia es irrelevante (17 embeddings), pero el flujo real de trabajo con el ERP de ~800 tablas es **iterar descripciones** (escribirlas a mano hoy, generarlas con SPEC-27 mañana), y cada iteración cuesta 800 embeddings en la nube. Quiero re-vectorizar **solo las tablas cuya descripción cambió**, detectándolo automáticamente: el índice ya guarda la descripción junto a cada vector, así que el diff sale de comparar el JSON contra lo indexado.

**Contrato.**

- *Caso de uso* `updateIndexedDescriptions(target, deps)` en `application/scan/`. Guardas de entrada: debe existir índice y ser de la MISMA BD (`targetName`); si no, error claro pidiendo escaneo completo. Siempre con el **modelo del índice** (nunca se mezclan espacios vectoriales).
- *Diff automático.* Comparando el JSON con la columna `description` del índice, tres conjuntos: **nuevas** (tabla indexada que ahora tiene descripción), **modificadas** (texto distinto) y **eliminadas** (la tenía y ya no está en el JSON — se re-embebe sin ella). Las entradas del JSON que no corresponden a ninguna tabla indexada se ignoran con aviso (típico: descripciones de otra BD, los ficheros de `descriptions/` se fusionan).
- *Coste mínimo.* Solo las tablas del diff pasan por el proveedor de embeddings; **sin cambios, cero llamadas**. El `search_text` se recompone con las columnas reales (`composeSearchText` + `readTargetSchema`, que es SQL gratis) y se hace `upsert` fila a fila — nunca `prepare()`.
- *Neo4j se actualiza a la vez.* La descripción vive en los dos almacenes (escaneo atómico, §6 de arquitectura): el mismo paso actualiza `Table.description` en el grafo para las mismas tablas. No puede divergir lo que ve la búsqueda de lo que muestra la traza.
- *Caso de uso testable (D-05).* Deps inyectadas (leer índice, leer esquema, embeber, upsert, actualizar grafo); reales por defecto, dobles en los tests.
- *CLI dentro del flujo de escaneo.* Al elegir BD en "Escanear", si hay índice de esa misma BD y fichero de descripciones, se pregunta el modo: **escaneo completo** (lo de siempre) o **solo actualizar descripciones**. El resumen dice qué pasó: nuevas/modificadas/eliminadas y cuántos embeddings se gastaron de cuántas tablas.
- *Fuera de alcance.* Detectar cambios de esquema (columnas o tablas nuevas): para eso está el escaneo completo, y el modo incremental no lo sustituye — el propio CLI lo dice al ofrecer el modo.

**Pasos**

1. `TableEmbeddingsStore.getIndexedDescriptions()` (tabla → descripción o null) y `SchemaGraphManager.updateTableDescriptions(cambios)` (un `UNWIND` + `SET`).
2. `application/scan/updateDescriptions.ts`: `diffDescriptions(indexadas, entrantes)` como función pura + el caso de uso con deps inyectadas.
3. CLI (`flows/schemaScan.ts`): la pregunta de modo cuando aplica, y el resumen del diff.
4. Tests unitarios con dobles: el diff (nuevas/modificadas/eliminadas/desconocidas), que solo se embebe lo cambiado, que sin cambios no se llama al proveedor, y las guardas (sin índice / índice de otra BD).
5. Documentar en `docs/uso.md` §3.

**Criterios de aceptación**

- [X] Cambiar UNA descripción y actualizar re-embebe solo esa tabla (verificado en vivo sobre Arcadia: 1 embedding de 17, y la restauración es idempotente — repetir da 0)
- [X] Sin cambios en el JSON, la actualización no llama al proveedor de embeddings (verificado en vivo: 0 embeddings, con las descripciones de otra BD ignoradas con aviso)
- [X] Quitar una descripción del JSON re-embebe esa tabla sin descripción
- [X] Neo4j y pgvector quedan con la misma descripción tras actualizar (verificado en vivo leyendo los dos almacenes)
- [X] Sin índice, o con índice de otra BD, el modo incremental no se ofrece / falla con mensaje claro
- [X] Suite unitaria verde con dobles, sin Docker ni proveedor de embeddings (230 tests)

```bash
cd backend && npm test    # unit del diff y del caso de uso (con dobles)
```

---

### SPEC-30 — Observabilidad local del pipeline (Phoenix + OpenTelemetry) 🔮 *Futuro (fuera del MVP)*

**Objetivo.** LangSmith sirvió para depurar los grafos en desarrollo, pero es un servicio en la nube y quedó desactivado a propósito en cuanto el proyecto tocó esquemas reales (D-14). Para operar GraphSQL con usuarios de verdad hace falta observabilidad **dentro del perímetro**: cada ejecución del pipeline como una traza (nodos, prompts, salidas, tokens, latencias, reintentos) en una pieza auto-alojada. Elijo **Arize Phoenix** sobre Langfuse por el mismo criterio que pgvector sobre Qdrant: un solo contenedor frente a ~6 servicios, y estándar OpenTelemetry — las mismas trazas podrían ir mañana a un colector corporativo (Grafana/Jaeger) sin tocar el código.

**Contrato.**

- *Opt-in de infraestructura.* Phoenix va en el `docker-compose.yml` bajo el profile `observability`: el `docker compose up -d` de siempre NO lo arranca (el preflight de SPEC-28 no cambia); `docker compose --profile observability up -d` lo añade, con su UI y su endpoint OTLP en `localhost:6006`.
- *Opt-in de aplicación.* La instrumentación se activa por variable de entorno; sin ella, cero overhead, cero conexiones salientes y cero dependencia cargada — el mismo patrón que LangSmith (que seguirá funcionando por sus propias variables, para quien lo prefiera en desarrollo).
- *Qué se traza.* Cada run del grafo como árbol: los nodos del pipeline, cada llamada LLM con su prompt/salida/tokens, y los reintentos del Judge. Todo se queda en la máquina: es la respuesta on-premise a "¿qué está haciendo el sistema por dentro?".
- *Bootstrap aislado.* La instrumentación vive en un módulo propio de infraestructura, importado solo desde el arranque del CLI: ni los casos de uso ni la orquestación saben que existe (mismo principio que el resto de recursos externos, D-05).
- *Fuera de alcance.* Métricas y alertas de producción, dashboards, gestión de retención, y la evaluación de prompts dentro de Phoenix.

**Pasos**

1. Servicio `phoenix` en el compose con `profiles: ["observability"]` y healthcheck propio.
2. Bootstrap OTel en `infrastructure/observability/` (SDK de Node + `@arizeai/openinference-instrumentation-langchain`), activado por variable de entorno e importado únicamente desde `cli/main.ts`.
3. Documentar en `instalacion.md`/`uso.md`: cómo encenderlo, qué se ve en la UI y la nota de privacidad (todo local).
4. Verificación en vivo: una consulta completa del pipeline aparece en Phoenix como árbol; sin la variable, ni instrumentación cargada ni tráfico hacia el 6006.

**Criterios de aceptación**

- [ ] `docker compose up -d` no arranca Phoenix ni altera el preflight; con `--profile observability`, sí
- [ ] Con la variable activa, una consulta aparece en Phoenix como árbol completo (recuperación → generación → Judge → reintentos) con prompts y tokens
- [ ] Sin la variable, no se carga la instrumentación ni hay conexiones salientes
- [ ] Los casos de uso y la orquestación no importan nada de OTel (solo el arranque del CLI)
- [ ] Docs actualizadas con la nota de privacidad

```bash
docker compose --profile observability up -d   # y una consulta desde el CLI
```

---

### SPEC-31 — Distribución: comando global `gsql` e imagen Docker de demo ✅ *Hecho*

**Objetivo.** Hasta ahora la única forma de arrancar GraphSQL era `cd backend && npm start`, con todas las rutas a recursos (`agents/`, `descriptions/`, `.env`, el compose) relativas al directorio de ejecución. Quiero dos canales de instalación (la decisión y sus alternativas descartadas, en D-16): el comando global **`gsql`**, invocable desde cualquier carpeta, para quien trabaja con el proyecto; y una **imagen Docker del CLI** para quien quiere evaluar la demo solo con Docker, sin instalar Node.

**Contrato.**

- *Rutas independientes del cwd.* La raíz del proyecto se resuelve desde el código (`projectRoot.ts`, con realpath para deshacer el junction de `npm link`), y de ella cuelgan `agents/`, `descriptions/`, `.env` y la búsqueda del `docker-compose.yml` del preflight. Ningún recurso depende de desde dónde se ejecute el proceso.
- *Comando global.* El campo `bin` del `package.json` registra `gsql` (lanzador en `backend/bin/gsql.js` que arranca tsx sobre el CLI real); `npm link` desde `backend/` lo instala en la carpeta global de npm y `npm unlink -g graphsql-backend` lo quita. Mismo programa que `npm start`: mismo menú, mismo `.env`, mismo preflight. Al ser un enlace, `git pull` actualiza el comando sin reinstalar.
- *Imagen de demo.* `Dockerfile` en la raíz (la app con sus dependencias de producción, los prompts y la config de ejemplo) + servicio `cli` en el compose bajo el profile `demo`: el `docker compose up -d` de siempre NO lo arranca ni cambia el preflight local. Dentro del contenedor el preflight se omite (`GRAPHSQL_SKIP_INFRA_PREFLIGHT=true`): no hay CLI de Docker dentro, y la infraestructura la garantiza compose con `depends_on: service_healthy`.
- *Credenciales que siempre cuadran.* El servicio `cli` recibe hosts de la red interna (`postgres`, `neo4j://neo4j:7687`) y las MISMAS expresiones de interpolación de credenciales con las que el compose crea Postgres y Neo4j, haya o no `.env` en el anfitrión. El proveedor LLM llega del `.env` del anfitrión (interpolación) y LM Studio se alcanza vía `host.docker.internal` (con `host-gateway` para Linux).
- *Confidencialidad.* La imagen copia SOLO `descriptions/*.example.json` (fichero a fichero) y el `.dockerignore` excluye la carpeta entera, el `.env` real y el resto de material local: las descripciones de una BD real (esquema de empresa) no entran jamás en un artefacto distribuible.
- *Fuera de alcance.* Ejecutable standalone y auto-actualización del comando. La publicación de las imágenes en un registro quedó fuera aquí y se hizo después en SPEC-33, al revisar D-16.

**Pasos**

1. `projectRoot.ts` y migrar a él `agentPrompts`, `descriptions`, la carga del `.env` (CLI y scripts de evaluación) y `findComposeDir` del preflight.
2. `backend/bin/gsql.js` + campo `bin` en `package.json`; `tsx` pasa a dependencia de producción (es el runtime del CLI).
3. Skip del preflight por `GRAPHSQL_SKIP_INFRA_PREFLIGHT` en `ensureInfrastructureReady`.
4. `Dockerfile` + `.dockerignore` + servicio `cli` (profile `demo`) en el compose.
5. Documentar: README, `instalacion.md` (comando `gsql` y demo Docker) y D-15 en arquitectura.

**Criterios de aceptación**

- [X] `gsql` desde una carpeta ajena al repo arranca igual que `npm start`: preflight, proveedor y menú con el índice detectado (verificado en vivo desde `%TEMP%`)
- [X] `npm start` desde `backend/` sigue funcionando exactamente igual
- [X] `docker compose --profile demo run --rm cli` llega al menú funcional conectando a Postgres y Neo4j por la red interna (verificado en vivo)
- [X] `docker compose up -d` (sin profile) no arranca el servicio `cli` ni cambia el preflight local
- [X] En la imagen no hay NINGÚN fichero de `descriptions/` salvo el ejemplo, ni `.env` del anfitrión (verificado inspeccionando la imagen construida con el `erp.json` real presente en local)
- [X] Typecheck y suite unitaria verdes (230 tests)

```bash
cd backend && npm link && cd /tmp && gsql        # canal 1: comando global
docker compose --profile demo build && docker compose --profile demo run --rm cli   # canal 2: demo Docker
```

---

### SPEC-32 — Instalador bootstrap de un comando (Windows y Linux/macOS) ✅ *Hecho*

**Objetivo.** SPEC-31 dejó los canales de distribución, pero instalar la herramienta seguía siendo una lista de pasos manuales (clonar, copiar configuración, `npm install`, `npm link`). Quien espera "un despliegue o una instalación" espera UN comando. Quiero un instalador bootstrap — el patrón de nvm/rustup: un script en el repo que se ejecuta con `irm | iex` (Windows) o `curl | bash` (Linux/macOS) — que deje GraphSQL instalado, configurado e invocable como `gsql`.

**Contrato.**

- *Un comando por sistema.* `install.ps1` (compatible con Windows PowerShell 5.1 y PowerShell 7) e `install.sh` (bash, Linux y macOS), ambos en la raíz del repo, ejecutables desde la URL raw de GitHub. Legibles: nada de binarios opacos.
- *Flujo idéntico en ambos.* (1) comprueba requisitos — Git y Node 20+ bloquean con mensaje y enlace; Docker solo avisa, porque la infraestructura la monta el CLI al arrancar (SPEC-28); (2) pregunta el directorio (defecto: `%LOCALAPPDATA%\GraphSQL` / `~/graphsql`); (3) clona el repo, o si ya hay una instalación hace `git pull` — **el mismo script es el actualizador**; (4) si no hay `.env`, lo crea del ejemplo y pregunta el proveedor (openai → pide y escribe la clave; local → fija `LLM_PROVIDER`/`EMBEDDING_PROVIDER`), y activa las descripciones de demo; si ya hay `.env`, lo conserva tal cual; (5) `npm install`; (6) pregunta si registra `gsql` (`npm link`), con la salida de permisos de Linux explicada si falla.
- *Interactivo pero automatizable.* Cada pregunta tiene defecto (Enter y sigue) y se puede fijar por variable de entorno (`GRAPHSQL_INSTALL_DIR`, `GRAPHSQL_PROVIDER`, `GRAPHSQL_OPENAI_KEY`, `GRAPHSQL_REGISTER_GSQL`, `GRAPHSQL_REPO_URL`); sin terminal (CI, `curl | bash` sin tty) cae a los defectos en vez de colgarse — en bash leyendo de `/dev/tty`, en PowerShell capturando el fallo de `Read-Host`.
- *Dónde termina.* El instalador NO monta infraestructura ni instala Docker/Node por debajo del usuario: termina en "escribe `gsql`", y de ahí sigue el arranque guiado de SPEC-28. El instalador instala la herramienta; la herramienta instala su infraestructura.
- *Fuera de alcance.* Instalador nativo (MSI/.deb), instalar los requisitos por el usuario, y desinstalador (documentado: `npm unlink -g` + borrar carpeta).

**Pasos**

1. `install.ps1` con las preguntas por función `Ask` (env var → prompt → defecto).
2. `install.sh` equivalente (prompts vía `/dev/tty`, `sed -i.bak` portable GNU/BSD).
3. Documentar como vía recomendada: README y tabla "¿Qué vía elijo?" de `instalacion.md`, con la sección "Instalación en un comando".

**Criterios de aceptación**

- [X] En Windows, instalación limpia no interactiva en una carpeta nueva: clona, escribe la clave en el `.env`, activa descripciones, `npm install` OK (verificado en vivo)
- [X] Segunda ejecución sobre la misma carpeta: `git pull`, conserva el `.env`, idempotente (verificado en vivo)
- [X] En Linux limpio (contenedor `node:20` sin Docker): avisa de Docker pero termina, configura proveedor local, registra `gsql` y el comando arranca y detecta la falta de Docker con el mensaje guiado (verificado en vivo)
- [X] Carpeta destino existente y no vacía que no es una instalación → error claro, sin tocar nada
- [X] Git o Node < 20 ausentes → bloquea con mensaje y enlace; Docker ausente → solo aviso

```bash
curl -fsSL .../install.sh | bash   # o: irm .../install.ps1 | iex — y después: gsql
```

---

### SPEC-33 — Imágenes en Docker Hub e instalación de la demo sin repo ✅ *Hecho*

**Objetivo.** La demo Docker de SPEC-31 aún exigía clonar el repo: la imagen del CLI se construía en local y el init de Postgres se montaba desde el clon. Revisada la frontera de confidencialidad en D-16 (el repo es público; lo privado son los datos del cliente), quiero las imágenes **publicadas en Docker Hub** y que evaluar la demo sea: descargar UN fichero y un `docker compose run` — sin Git, sin Node, sin clonar.

**Contrato.**

- *Dos imágenes públicas, versionadas.* `pclota/graphsql-cli` (la aplicación, la misma de SPEC-31) y `pclota/graphsql-postgres-demo` (pgvector + los scripts de init horneados en `/docker-entrypoint-initdb.d`, solo bases sintéticas por seed), con tags `latest` y de versión (`0.1.0`). El `image:` del compose del repo usa el mismo nombre publicable, así `--profile demo build` produce directamente lo que se sube.
- *Un compose autónomo.* `docker-compose.hub.yml` en la raíz del repo, descargable por URL raw: los tres servicios desde el registro, mismos healthchecks (incluido el marcador de init) y las mismas expresiones de credenciales en creador y consumidor. Sin `container_name` (no puede chocar con una instalación del repo en la misma máquina) y sin montar nada del disco.
- *Auditoría antes de publicar.* Ningún artefacto sube sin comprobar que no lleva claves ni datos sensibles: escaneo de patrones de API keys sobre el sistema de ficheros de la imagen y revisión de `.env` (solo placeholders y la contraseña local de demo, ya pública en `.env.example`) y de `descriptions/` (solo el ejemplo).
- *Fuera de alcance.* CI que construya y publique en cada release (hoy es manual), firma de imágenes, y multi-arquitectura (amd64 solo; arm64 queda para cuando alguien lo pida).

**Pasos**

1. `setup/infra/postgres/Dockerfile` (pgvector + `COPY init/`).
2. `docker-compose.hub.yml` + `image: pclota/graphsql-cli` en el compose del repo.
3. Auditar, `docker push` (2 imágenes × 2 tags) y documentar (README + instalacion.md, la vía demo ya sin Git).

**Criterios de aceptación**

- [X] Desde una carpeta vacía con SOLO `docker-compose.hub.yml` (sin repo), `docker compose run --rm cli` descarga las imágenes, el init horneado carga arcadia (320 juegos) y nebula, y el CLI llega al menú detectando que falta escanear (verificado en vivo con volúmenes vírgenes)
- [X] Las imágenes publicadas responden en el registro (`docker manifest inspect`) y no contienen claves, `.env` real ni descripciones reales (auditado sobre la imagen construida)
- [X] La vía del repo (`--profile demo build/run`) sigue funcionando igual y produce la imagen con el nombre publicable

```bash
curl -fsSL -O https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/docker-compose.hub.yml
docker compose -f docker-compose.hub.yml run --rm cli
```

---

### SPEC-34 — Zod como validador único en las fronteras externas (D-17) ✅ *Hecho*

**Objetivo.** El `.env` y el fichero de descripciones ya se validaban con Zod, pero el resto de fronteras externas (variables de entorno leídas ad-hoc por cada factory, respuestas JSON del LLM, filas de Neo4j/Postgres) seguían con `env.X ?? 'default'` repetido y funciones sueltas reinventando la misma tolerancia (`toStringArray`, `toConfidence`, `toTablePurposes`…). Quiero un catálogo único de entorno y esquemas declarativos en las otras dos fronteras, para que un valor mal formado falle con un mensaje claro en el sitio donde entra, no como un `NaN` o un `undefined` silencioso más abajo.

**Contrato.**

- *Catálogo único de entorno* (`infrastructure/config/env.ts`): un `envSchema` con el nombre, el default y el formato de cada variable estática; `loadEnv()` se evalúa en cada llamada (nada de singleton), porque el selector del CLI muta `process.env.LLM_PROVIDER` en caliente y los tests inyectan su propio `env`. Las variables numeradas por BD objetivo (`TARGET_DB_N_*`) quedan fuera, las sigue gestionando `targetDatabases.ts` porque sus claves son dinámicas.
- *Respuestas del LLM* (Judge, juez de equivalencia): esquemas con `.catch()` que mantienen la MISMA tolerancia de antes campo a campo (una fuente desconocida → `assumed`; una confianza fuera de rango → recortada; un campo ilegible → valor neutro), pero solo `valid`/`equivalent` invalida la respuesta entera.
- *Filas de infraestructura*: `Neo4jConnection.runValidated(schema, cypher, params)` valida cada fila Cypher contra un esquema (protege el contexto que llega al generador de SQL de un alias de RETURN desalineado); la fila del modelo indexado en `TableEmbeddingsStore` y el fichero `escala-casos*.json` de las tiradas de evaluación (`scaleRunFile.ts`) siguen el mismo patrón.
- *Dónde NO entra Zod.* Los tipos internos del dominio ya los valida TypeScript en compilación; Zod solo donde la forma del dato depende de algo externo (entorno, LLM, fila de infraestructura, fichero editado a mano entre tiradas).
- *Decisión de diseño en D-17*, no en el código: los comentarios de cada esquema explican el comportamiento local (qué tolera, por qué), no el porqué de elegir Zod — eso vive en `arquitectura.md` §7 y en la propia D-17.

**Pasos**

1. `infrastructure/config/env.ts` (`envSchema` + `loadEnv`) y migrar las factories/adaptadores que leían `process.env` a mano (`CheckpointerFactory`, `EmbeddingsFactory`, `Neo4jConnection`, `TableEmbeddingsStore`, `ChatModelFactory`, `OpenAIChatModel`, `LocalChatModel`, `modelSelection`, `ui.ts`, `infraPreflight.ts`, `conversation.ts`).
2. Esquemas tolerantes en `sqlJudging.ts` (`judgeReplySchema`, con las listas y el `table_purposes` tolerantes) y `sqlEquivalence.ts` (`equivalenceReplySchema`), sustituyendo los helpers manuales.
3. `Neo4jConnection.runValidated` + esquemas de fila en `SchemaGraphManager`; `indexedModelRow` en `TableEmbeddingsStore`; `modelsResponseSchema` en `lmStudio.ts`; `embeddingsResponseSchema` en `OpenAICompatibleEmbeddings`.
4. `evaluation/scaleRunFile.ts` (`loadScaleRun`) para leer los `escala-casos*.json`, adoptado por `aggregateScaleRuns.ts` y `reviewCases.ts`.
5. D-17 en la tabla de decisiones y su prosa en `arquitectura.md` §7.

**Criterios de aceptación**

- [X] Ninguna factory ni adaptador lee `process.env.<VARIABLE_DEL_CATÁLOGO>` directamente; solo `loadEnv()` (verificado por grep sobre `backend/src`)
- [X] Una respuesta del Judge con un campo mal formado (p. ej. `confidence` fuera de 0-1, una `source` desconocida en `table_purposes`) sigue devolviendo un veredicto usable, con el mismo comportamiento tolerante que antes del refactor
- [X] Un alias de RETURN desalineado en una consulta de `SchemaGraphManager` falla con un error de Zod en vez de propagar `undefined`
- [X] Typecheck y suite unitaria verdes (230 tests) tras migrar los 19 ficheros afectados

```bash
cd backend && npm run typecheck && npm test
```

---

## Mejoras futuras (backlog, sin SPEC todavía)

Ideas que veo venir pero que aún no voy a implementar. Las aparco aquí en una línea cada una para no engordar el SDD con specs prematuras: cuando decida hacer una, la promociono a su SPEC-xx con contrato y criterios, y la borro de esta lista.

**Afinado de la recuperación por capas (SPEC-26).**

- *Pool del selector relleno desde el ranking global.* Hoy el pool sale solo de la expansión (anclas + vecinas + conectores): si la expansión trae 12 tablas, el selector ve 12, no ~30. Rellenarlo con las siguientes del ranking fusionado hasta `SELECTOR_POOL_SIZE` es el cambio barato que más recall le da al selector (el pivote entraría aunque el léxico y el grafo fallen a la vez).
- *Presupuesto en el completado por grafo de la selección.* `completeSelectionForJoins` no tiene tope: si el LLM elige muchas tablas y cada una referencia varias dimensiones, el contexto puede superar de largo `maxTables`. Acotarlo con la misma prioridad (elegidas > destinos FK > conectores).
- *Parseo del selector más estricto.* El fallback de troceo por tokens puede colar una tabla que el LLM menciona precisamente para descartarla ("no incluyo X porque…"). Exigir la lista JSON y reintentar una vez antes de caer al recorte.

**Descripciones automáticas (SPEC-27, hecho — lo que queda).**

- *Medir cuánto aportan las generadas.* El arnés de la ablación (`evaluate:descriptions`, 2×2 vectorial/GraphRAG × con/sin descripciones) lee `descriptions/` tal cual, así que ya se pueden medir las de una BD descrita por IA y compararlas con el caso sin descripciones. Es el paso más barato y el que dice si merece la pena todo lo demás.
- *Concurrencia acotada + guardado incremental.* Hoy va tabla a tabla y solo escribe el fichero al final: en Meridian son ~20 min con el modelo local, y en el ERP real de ~800 tablas serían horas que un Ctrl+C tira enteras. Un puñado de llamadas en paralelo y un guardado por tabla (o por lote) lo vuelven reanudable y lo bajan a minutos.
- *Reanudar y no repetir.* Saltar las tablas que ya tienen descripción para completar solo los huecos, que es el modo natural de trabajar sobre un esquema grande.
- *Fusionar en vez de reescribir.* El fichero de la BD se sobrescribe entero, así que una segunda pasada pisa lo que se haya editado a mano. Respetar las manuales (como pedía el contrato original) y tocar solo lo que falta.
- *Revisión antes de escribir.* Previsualizar y aceptar/editar tabla a tabla, en la línea de la revisión humana del resto del sistema, en vez de escribir primero y avisar de que se revise después.
- *Avisar de las tablas que fallaron.* Una tabla sin descripción se descarta en silencio al guardar; el resumen debería decir cuáles quedaron fuera para poder reintentarlas.
- *Descripciones de columna, no solo de tabla.* Es la palanca grande para esquemas opacos —el experimento de confusión (SPEC-21) ofusca precisamente las columnas (`c1..c5`)—, pero es una spec en sí misma, no un afinado de esta.

**Escala (esquemas de cientos de tablas, como el ERP real de SPEC-26).**

- *Recuperación multi-consulta por entidades.* El problema de raíz del entity-pivot es que UNA consulta vectorial mezcla "abonado" y "fibra" y gana el tema dominante. Extraer las entidades de la pregunta (rol `reasoning`) y lanzar un top-K por entidad, fusionando con el mismo RRF que ya tengo: ataca la causa en vez de rescatar a la víctima.
- *Particionado por dominios.* Detección de comunidades sobre el grafo de FK (Louvain / label propagation, Neo4j GDS) para partir el ERP en módulos (facturación, líneas, abonados…): primero clasificar la pregunta en 1-2 dominios, después rankear solo dentro. El pivote deja de competir contra 800 tablas.
- *Ranking léxico dentro de Postgres.* `rankTablesLexically` se baja el `search_text` de todas las tablas en cada pregunta y hace trigramas en memoria; con `pg_trgm` (o `tsvector`) el mismo ranking queda indexado en la base y escala. Mientras tanto, cachear `getAllTableTexts` (el esquema cambia por escaneo, no por consulta).
- *Poda de columnas en el DDL.* En un ERP real el coste de tokens no son las 8 tablas sino las tablas de 100+ columnas. Recortar el DDL a las columnas relevantes (coincidencia léxica con la pregunta + siempre PK/FK) reduce el contexto del generador y las alucinaciones de columna; el modo depuración ya imprime el DDL para verificarlo a mano.
- *Reutilización de conexiones en el circuito de recuperación.* Con las tres capas activas hay 5-6 aperturas/cierres de Neo4j y Postgres por pregunta. Tolerable en el CLI; latencia gratuita con usuarios delante.
- *Golden set sobre el ERP real.* Las capas de SPEC-26 solo tienen validación cualitativa (casos de la depuración). Un golden set pequeño (15-20 preguntas) sobre la BD real permitiría medir la contribución de cada palanca (léxico solo, +caminos, +selector) con el arnés de SPEC-11.

**Motor embebido bajo el producto de un tercero (OEM).**

Dirección nueva: empresas que quieren GraphSQL **debajo** de su ERP o de su frontend propio, para dar consulta directa a la BD y agilizar el BI y el análisis de datos de sus clientes (pyme y mediana empresa). Cambia quién es el usuario: el anfitrión pone la identidad, la interfaz y la presentación; yo pongo el motor. Lo apunto entero aquí porque toca decisiones, no solo componentes.

- *Contrato público versionado.* Si otros construyen encima, la forma de los puertos y de los casos de uso pasa a ser API: un cambio de firma les rompe el producto. Hoy no hay ninguna superficie declarada como pública ni política de versionado. Decidir qué exporto, congelarlo y versionarlo (semver) antes de que haya un integrador, no después.
- *Interfaz programática con la pausa expuesta.* La integración natural NO es lanzar el CLI como subproceso y parsear su salida: es una API (librería, y sobre ella HTTP o MCP) que reciba pregunta + inquilino y devuelva la consulta propuesta con su veredicto. La clave es que `interrupt_before` ya persiste la pausa en PostgreSQL por `thread_id` (SPEC-08): eso permite que el anfitrión pinte SU pantalla de aprobación y reanude el hilo después. Exponer la pausa, no esconderla tras un "sí a todo".
- *Política de aprobación configurable (decisión pendiente, candidata a D-xx).* La revisión humana es el argumento de seguridad del sistema, pero un producto que vende "BI ágil" no va a pedir aprobación en cada pregunta. Hay que decidir explícitamente qué se permite: aprobación siempre, auto-aprobación solo si pasa la capa determinista, o delegada al anfitrión bajo su responsabilidad. Es una decisión con consecuencias de responsabilidad, no una opción de configuración que se pueda dejar sin declarar.
- *Multi-inquilino como prerrequisito, no como futuro.* SPEC-20 está marcada 🔮, pero con varios clientes debajo de un mismo anfitrión deja de ser comodidad: hoy `TableEmbeddingsStore.prepare` hace `DROP TABLE IF EXISTS table_embeddings` y la ingesta hace `MATCH (n:Table) DETACH DELETE n`, así que **escanear la BD de un cliente borra el índice de todos los demás**. Mientras el índice sea de un solo inquilino, el modo OEM no es viable.
- *Metadatos curados por inquilino, no ficheros del repo.* Las descripciones viven en `descriptions/<bd>.json`, y las relaciones sintéticas (SPEC-22) y un futuro glosario seguirían el mismo patrón de sidecar. Como librería dentro del producto de otro, y con N clientes, un directorio del repositorio no sirve: los metadatos curados tienen que poder cargarse por inquilino desde el almacén o por API. Esto reabre el contrato de SPEC-22 antes de implementarla.
- *Identidad y credenciales delegadas al anfitrión.* No monto login: el anfitrión ya sabe quién pregunta. Lo que necesito es aceptar por llamada la identidad y las credenciales de conexión del usuario final, para que el RLS y los roles que el ERP ya tiene apliquen solos, y para que ese `user_id` viaje a la auditoría y al coste. Es bastante más pequeño que construir autenticación, y es lo correcto.
- *Concurrencia y ciclo de vida de las conexiones.* El circuito de recuperación abre y cierra Neo4j y Postgres 5-6 veces por pregunta, y los casos de uso construyen sus dependencias por defecto con `fromEnv()`. Para un CLI de un usuario es indiferente; sirviendo peticiones concurrentes es lo primero que se cae. Hace falta pool y configuración explícita por llamada en vez de ambiental.
- *Perfiles de recuperación por inquilino.* `SEMANTIC_TOP_K`, `MAX_CONTEXT_TABLES`, `SELECTOR_POOL_SIZE` y `PATH_MAX_LENGTH` son constantes en el código: ajustarlas para un cliente obliga a editar TypeScript. Con varios clientes de tamaños distintos, el perfil tiene que ser dato del inquilino, y las variables de entorno no son el sitio.
- *Registro de auditoría append-only.* Hoy no queda rastro de nada: el `thread_id` se genera, se ejecuta y se pierde. Vendiendo a través de un anfitrión que responde ante sus clientes, "quién preguntó qué, qué SQL se aprobó y cuántas filas salieron" pasa de buena práctica a entregable contractual. Sin valores de resultado, con retención configurable.
- *Lista de exclusión de tablas y columnas sensibles.* La recuperación ofrece cualquier tabla indexada y el DDL vuelca todas sus columnas: nada impide hoy que `password_hash`, nóminas o un IBAN entren en el prompt y acaben en pantalla. Aplicada en ingesta, en el render del DDL y en la capa determinista del Judge, para que no dependa del criterio del LLM. Es la simétrica restrictiva de SPEC-22.
- *Errores tipados como parte del contrato.* Un integrador necesita distinguir "el LLM no responde" de "el índice está obsoleto" de "la BD del cliente rechaza la conexión". Hoy todo sale como un `Error` con el mensaje dentro y un `try/catch` grande en el flujo del CLI. Errores de dominio con código, y reintentos con backoff solo para lo transitorio (429, 5xx, timeout), que los adaptadores van con `maxRetries: 1`.
- *Coste y latencia por inquilino.* Una pregunta gasta 6-8 llamadas al LLM y el sistema no dice nunca cuánto ha costado. Con clientes debajo hace falta contabilizarlo por inquilino, poder ponerle tope y decidir qué pasa al superarlo (avisar, degradar el selector, o cortar).

**Motores de BD (la pyme no siempre es PostgreSQL).**

- *MySQL / MariaDB.* `TargetDatabaseFactory` solo resuelve `postgresql` y `mssql`; en pyme, MySQL y MariaDB son mayoría. Es el hueco más comercial que tengo: sin ese adaptador, buena parte del mercado al que apunta el modo OEM no se puede ni conectar.
- *Tests de conformidad puerto↔adaptador.* El patrón de §3.1 promete que añadir un motor es "un adaptador + un case en la factory", pero nada lo verifica: `SqlServerTargetDatabase` y `SqlServerSchemaReader` no tienen ningún test unitario. Una batería parametrizada sobre el contrato de `ITargetDatabase` e `ISchemaReader`, que todo adaptador tenga que pasar, convierte la convención escrita en garantía ejecutable.

**Seguridad y coste de la ejecución.**

- *Guardián de coste con el plan de EXPLAIN.* `dryRun` ya pide el `EXPLAIN` y tira el resultado: solo mira si peta. Leer de ahí el coste y las filas estimadas y devolverlo junto al veredicto (con umbrales de aviso y de bloqueo) sale casi gratis, y evita que un producto cartesiano se coma los 15 s de `STATEMENT_TIMEOUT_MS` contra la BD productiva de un cliente.
- *Preflight de mínimo privilegio.* Doy por hecho un usuario de solo lectura, pero eso solo se fuerza en PostgreSQL y por sesión; en SQL Server lo garantiza el rol de conexión y nadie lo comprueba. Verificar los permisos al conectar y avisar (o impedir operar) si el usuario puede escribir.
- *`checkSqlSafety` no distingue literales de cadena.* Las palabras prohibidas y los patrones `--` y `/* */` se buscan con regex sobre el texto crudo, así que una consulta legítima como `WHERE observaciones ILIKE '%alta -- urgente%'`, o cualquier filtro por un valor que contenga `CREATE` o `CALL`, se rechaza como insegura. En un ERP con texto libre esto va a salir. Tokenizar ignorando el interior de los literales antes de aplicar las reglas.

**Calidad continua (hoy no hay red).**

- *Integración continua.* No hay `.github/`: la única garantía es un hook `pre-push` de husky, que corre en mi máquina y se puede saltar. Tampoco hay linter ni formatter. Con integradores debajo, typecheck + tests + lint en cada PR es lo mínimo.
- *Gate de regresión de la evaluación.* Los prompts de `agents/*.md` se editan como texto y se cargan sin recompilar: cualquiera puede degradar el sistema sin que nada se entere, y las tiradas no registran con qué prompt ni con qué modelo se obtuvieron. Registrar el hash de cada prompt y el modelo por rol en cada tirada, y un subconjunto del golden set que falle si el recall cae respecto a la referencia.
- *Capturar lo que falla, no solo lo que sale bien.* SPEC-09 guarda las consultas buenas como ejemplos; nadie recoge las malas. El rechazo, el número de afinados y la SQL editada a mano ya existen en el estado y se pierden con el hilo, y son justo la señal de dónde falla el sistema en casa de cada cliente (y candidatos a golden set propio).

**Metadatos que suben el techo de la recuperación.**

- *Diccionario de valores (value linking).* El DDL lleva nombres, tipos, claves y la descripción de tabla, pero nunca los **valores**: ante "cuántas líneas activas hay", el modelo adivina si eso es `estado = 'A'`, `'ACTIVA'` o `1`. Muestrear las columnas de baja cardinalidad al escanear y meter el dominio como comentario en el DDL de las tablas recuperadas. SPEC-27 ya muestrea filas con su guardarraíl de privacidad, así que la pieza de muestreo y de consentimiento ya está escrita; aquí se reutiliza para otro fin.
- *Glosario de negocio y sinónimos curados.* El ranking léxico rescata "abonado" → `abonats` por trigramas, pero no rescata nada cuando la organización dice "cartera" o "expediente" y la tabla se llama otra cosa. Un glosario curado por el funcional (término, sinónimos, tablas, columnas) usado en tres puntos: expansión de la pregunta, señal directa de promoción y bloque de vocabulario en el prompt. Es la palanca humana y barata frente al particionado por dominios, que es la automática y cara.
- *Exponer la ambigüedad como dato, no como diálogo.* Cuando el selector duda entre tablas alternativas o la pregunta no fija un periodo, hoy el sistema elige en silencio y solo se ve leyendo la SQL. Bajo un frontend ajeno no me toca a mí abrir una conversación: me toca devolver que hay ambigüedad y entre qué opciones, y que el anfitrión decida si pregunta. Encaja con la traza de SPEC-13.
