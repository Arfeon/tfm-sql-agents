# Glosario

Términos que uso en la documentación y que no tienen por qué ser obvios. Los explico en el
sentido concreto que tienen **en este proyecto**, no en abstracto.

### Ablation (estudio de ablación)
Forma de evaluar un sistema **quitándole piezas de una en una** para ver qué aporta cada una.
Aquí comparo tres formas de dar contexto al LLM —sin recuperación / solo búsqueda vectorial /
GraphRAG completo— y con/sin descripciones: si al quitar una pieza el resultado empeora, esa
pieza aportaba.

### RAG (Retrieval-Augmented Generation)
En vez de que el LLM responda "de memoria", primero **recupero** información relevante y se la
paso junto a la pregunta. Aquí lo recuperado es el trozo de esquema (las tablas) que hace falta.

### GraphRAG
Un RAG en el que la recuperación usa un **grafo**. Aquí: busco tablas candidatas por significado
(embeddings en pgvector) y luego las **expando siguiendo las claves foráneas** en un grafo (Neo4j)
para traer las tablas relacionadas que hacen falta en los JOIN.

### Embedding
Representación de un texto como un **vector de números**, hecha de modo que textos con significado
parecido quedan "cerca". Permite buscar por significado (`clientes` encuentra `customer`) en vez
de por palabras exactas.

### pgvector
Extensión de PostgreSQL que guarda esos vectores y sabe buscar los más parecidos. Es donde vive la
búsqueda semántica del esquema.

### Neo4j / grafo de conocimiento
Base de datos de **grafos** (nodos y relaciones). Modelo el esquema como grafo: cada tabla es un
nodo y cada clave foránea una relación, así puedo "saltar" de una tabla a las relacionadas.

### Clave foránea (FK, *foreign key*)
Columna de una tabla que apunta a la clave de otra (p. ej. `customer.region_id` → `region`). Es la
relación que sigo para expandir de una tabla a sus vecinas.

### Schema-linking
El paso de **decidir qué tablas y columnas** del esquema hacen falta para responder una pregunta.
Es el corazón del problema: con un esquema grande, acertar aquí es la mitad del trabajo.

### Schema-linking recall
Métrica: de las tablas que la SQL correcta **debería** tocar, qué fracción recupera el sistema.
Mide solo la recuperación, sin depender de que el LLM luego escriba bien la SQL.

### Execution accuracy
Métrica: la SQL generada, **ejecutada** contra la base de datos, ¿da el **mismo resultado** que la
SQL de referencia? Comparo el resultado (las filas), no el texto de la consulta, porque una misma
pregunta admite varias SQL correctas equivalentes. La mido en dos variantes: **estricta** (resultado
idéntico, cota inferior) y **justa** (la candidata *contiene* el resultado de referencia, así no
penalizo una columna descriptiva de más).

**Sesgos conocidos** (detalle en [arquitectura §10](design/arquitectura.md)): (1) *columna de más* —
la variante estricta marca como fallo una consulta correcta que devuelve un `id` extra; la justa lo
corrige. (2) *interpretación de la referencia* — comparo contra UNA sola SQL de referencia, que fija
una interpretación; si una pregunta admite varias lecturas válidas (p. ej. `INNER` vs `LEFT JOIN`:
incluir o no las categorías sin actividad), penalizo una alternativa igual de válida o incluso mejor.
Un caso engañoso: si en los datos ninguna categoría está vacía, `INNER` y `LEFT` dan las MISMAS filas,
así que la comparación de resultados no ve una diferencia que sí existe en la consulta.

### Equivalencia semántica (LLM como juez)
Métrica **complementaria** a la execution accuracy: si la candidata se ejecuta, un segundo LLM decide
si responde a la **misma pregunta** que la de referencia, ignorando diferencias que no cambian la
respuesta (orden, columnas de más, empates en un top-N, agregaciones equivalentes). Recupera aciertos
que la comparación de resultados descarta —comparar filas exige un resultado casi idéntico, y como el
LLM no es determinista eso es casi imposible—. Pero un LLM-juez también se equivoca (la equivalencia
de consultas es indecidible en general), así que la reporto **al lado** de la execution accuracy
objetiva, nunca en su lugar.

### DDL (*Data Definition Language*)
El texto tipo `CREATE TABLE ...` que describe una tabla (columnas, claves). Es el formato en que le
paso el esquema recuperado al LLM como contexto.

### Dialecto SQL
La variante concreta de SQL de cada motor (PostgreSQL, SQL Server…). La inyecto en el prompt para
que la consulta salga en la sintaxis correcta.

### LLM (*Large Language Model*)
El modelo de lenguaje. Aquí lo uso para **generar** la SQL a partir de la pregunta y el contexto, y
como **juez** que la revisa.

### Golden set
El conjunto de preguntas de evaluación, cada una con su SQL de referencia y las tablas que debería
tocar. Es el "examen" con el que mido el sistema.

### top-K
Quedarse con los **K primeros** de una lista ordenada. Aquí: las K tablas que ganan el ranking
(híbrido) y que tomo como **anclas** antes de expandir por el grafo.

### Ancla
Una de las tablas **ganadoras del ranking**: las que más se parecen a la pregunta (por significado
o por palabras). Las llamo anclas porque son el punto donde "echo el ancla" en el grafo: desde
ellas salgo a buscar el resto de tablas necesarias siguiendo las claves foráneas. Si la pregunta
es "¿qué abonado tiene más líneas de fibra?", las anclas serían las tablas de abonados y de líneas.

### Tabla vecina
Tabla que está a **una clave foránea de distancia** de un ancla (un "salto" en el grafo). Si
`pedido.cliente_id` apunta a `cliente`, entonces `cliente` es vecina de `pedido` (y al revés).
Las traigo porque la respuesta muchas veces no está en la tabla que se parece a la pregunta,
sino en la de al lado.

### Conector (o puente)
Tabla **intermedia en el camino** entre dos anclas: sin ella, el JOIN entre las otras dos no se
puede escribir. El caso típico es una tabla central muy conectada o una tabla de unión N-a-N —
justo las que nunca "se parecen" a ninguna pregunta, por eso hay que rescatarlas por estructura
y no por similitud. Si el grafo dice `datos_fiscales → abonado → línea`, `abonado` es el puente
entre las otras dos.

### Destino de FK (dimensión)
La tabla **a la que apunta** una clave foránea de un ancla. Si el ancla es `línea` y tiene
`línea.id_abonado → abonado`, entonces `abonado` es un destino de FK: ahí suele vivir el *nombre*
de la cosa por la que se pregunta (la tabla con los datos descriptivos, lo que en almacenes de
datos se llama "dimensión"). Se protege del recorte aunque su score sea bajísimo.

### Ranking híbrido (denso + léxico, fusión RRF)
Dos formas de ordenar las tablas por relevancia, fusionadas: el ranking **denso** compara
*significados* (embeddings: "suscriptor" encuentra `abonados` aunque no compartan letras) y el
**léxico** compara *letras* (trigramas: "abonado" casa con `abonats` aunque el embedding la
entierre). Se fusionan con **RRF** (*Reciprocal Rank Fusion*), que ignora los scores —no son
comparables entre sí— y suma puntos según la **posición** en cada lista: destacar en cualquiera
de las dos te sube, sin ningún peso que calibrar a mano.

### Pool de candidatas
La lista de **~30 tablas** que sobreviven al ranking y a la expansión por grafo, y entre las que
el selector LLM hace su elección. Es el equilibrio entre darle opciones de sobra (recall) y no
darle un catálogo inabarcable.

### Selector (LLM)
El paso en que un LLM **lee la pregunta y el pool y elige** las tablas necesarias, razonando lo
que la similitud no sabe: entre doce tablas de fibra igual de "parecidas", cuál hace falta para
*esta* pregunta. Tiene tres límites de seguridad: no puede inventar tablas (su respuesta se filtra
contra el pool), no puede bloquear (si falla o no elige nada, se usa el recorte por prioridad) y
no puede quitar las tablas fijadas a mano.

### Recorte por prioridad
Cómo se reduce la lista al **presupuesto final** (8 tablas por defecto) cuando no decide el
selector. No es un simple corte por score: primero manda el **motivo** por el que entró cada tabla
(fijada a mano > ancla > conector > destino de FK > vecina genérica) y solo a igual motivo
desempata el score. Sin ese orden, la similitud expulsaría justo a los puentes que la pregunta
no menciona pero el JOIN necesita.

### Tabla fijada (*pinned*)
Tabla que el usuario **fuerza a mano** a entrar en el contexto (desde la revisión humana). Entra
siempre: sobrevive a cualquier recorte y el selector no puede quitarla.

### Judge (juez)
El agente que **valida** la SQL antes de ejecutarla: que sea de solo lectura y segura, que la
sintaxis sea válida, y que tenga sentido. Puede bloquear (seguridad/sintaxis) o solo avisar (LLM).

### Supervisor
El **enrutador** del pipeline: decide el siguiente paso con reglas sobre el estado (no con un LLM),
incluido el reintento automático cuando el Judge no da la consulta por buena.

### Checkpointer
Pieza de LangGraph que **persiste el estado** del grafo (en PostgreSQL). Es lo que permite pausar
el flujo y reanudarlo más tarde por su identificador de hilo (`thread_id`).

### Human-in-the-loop / *interrupt*
Meter a una persona en medio del flujo automático: el grafo se **pausa** antes de ejecutar y espera
mi aprobación. Ninguna consulta se ejecuta sin visto bueno.

### Multiconjunto (*multiset*)
Un conjunto que **permite elementos repetidos**. Lo uso al comparar resultados de consultas: mismas
filas, sin importar el orden.
