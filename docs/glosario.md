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
Quedarse con los **K primeros** de una lista ordenada. Aquí: las K tablas más parecidas por
significado que tomo como candidatas antes de expandir por el grafo.

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
