# Evaluación: cómo leer estos informes

Aquí mido una sola cosa: **¿sirve de algo el GraphRAG?** Es decir, cuando el sistema busca las tablas relevantes con el grafo, ¿acierta más y con menos contexto que las alternativas? Esta página explica qué significan las tablas de los demás informes de esta carpeta, para que se lean sin dudas. Si un número te choca, vuelve aquí.

## Qué comparo: tres formas de dar contexto al LLM

Cada pregunta se resuelve de tres maneras, y comparo los resultados:

- **Sin recuperación** — le doy al LLM el **esquema entero** (todas las tablas). Es la baseline: no hay nada más simple que "dárselo todo".
- **Solo vectorial** — le doy solo las tablas que se parecen a la pregunta por significado (búsqueda semántica), sin más.
- **GraphRAG** — las del vectorial **más** las que están conectadas por clave foránea (la expansión por el grafo). Es lo que hace el sistema de verdad.

## Qué significa cada columna

| Columna | Qué mide | Quién lo decide |
|---------|----------|-----------------|
| **Schema-linking recall** | De las tablas que necesita la consulta correcta, cuántas llegaron al contexto. 100% = estaban todas delante. | Objetivo (comparar listas de tablas). No depende del LLM. |
| **Execution accuracy (justa)** | Ejecuto la SQL generada y la de referencia; ¿la generada contiene el resultado correcto? Permito columnas de más, pero no filas ni valores distintos. | Objetivo (comparar resultados reales en la BD). |
| **Execution accuracy (estricta)** | Igual pero exigiendo resultado **idéntico**. Es una cota inferior: penaliza una columna de más. | Objetivo. |
| **Equivalencia (LLM)** | Un segundo LLM juzga si la consulta responde a la MISMA pregunta (rescata aciertos que la comparación de filas descarta por redondeos o columnas de más). | Un LLM. **Se equivoca.** |
| **Tokens de contexto** | Tamaño del contexto que viaja al LLM en cada llamada. Menos = más barato y más viable en local. | Objetivo. |

## Reglas para leerlo sin equivocarse

1. **Las métricas objetivas mandan.** Recall y execution accuracy (justa) se calculan ejecutando y comparando de verdad; son la referencia. La equivalencia del LLM va **al lado**, como complemento, nunca como titular.
2. **La equivalencia es un LLM opinando, y falla.** Solo la uso para *rescatar* aciertos que la comparación objetiva descarta (nunca para quitar los que ya da por buenos). Por diseño, la equivalencia es siempre ≥ la justa.
3. **Con pocos casos, ignora la equivalencia entre modos.** En el experimento de confusión son 6 casos: cada uno vale ~17%, así que una diferencia de un caso no significa nada. Ahí mira **recall y justa**. (Ejemplo real que confundió: "solo vectorial" salía con más equivalencia que GraphRAG por *un* caso rescatado por el juez, mientras la justa era idéntica y el recall de GraphRAG era mayor — el GraphRAG era mejor, no peor.)
4. **Una sola tirada baila.** La generación del LLM no es determinista: entre tiradas el mismo caso puede cambiar ±varios puntos. Por eso la prueba de escala se reporta como **media de 5 tiradas** (`escala-tiradas.md`), no una suelta.

## Qué informe es cada cosa

- **`resumen.md`** — el ablation base sobre Arcadia (3 modos × con/sin recuperación).
- **`descripciones.md`** — qué aportan las descripciones de tablas (con/sin), con el foco en la tabla de nombre opaco `t_042`.
- **`escala.md`** — una evaluación completa sobre las dos BDs (Arcadia 17 tablas, Nebula 66); muestra cómo el contexto del GraphRAG se mantiene plano al crecer el esquema.
- **`escala-tiradas.md`** — la media de 5 tiradas de la prueba de escala (el dato en el que confiar para la escala).
- **`confusion.md`** — el caso difícil: tablas y columnas con nombres opacos. Mide quién sobrevive sin descripciones.
- **`escala-coder14b.md`** — verificación con el modelo **100% local** (Qwen2.5-Coder-14B), para enseñar que la ventaja no depende de estar en la nube.
- **`escala-casos.json`** — el detalle por caso (la SQL generada de cada pregunta), por si quieres abrir un caso concreto.
