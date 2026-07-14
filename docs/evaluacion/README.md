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

1. **Las métricas objetivas mandan, y la equivalencia responde la pregunta de producto.** Recall y execution accuracy (justa) se calculan ejecutando y comparando de verdad: son el **suelo objetivo** y siempre se muestran. La **equivalencia** es la que responde a "¿el sistema contesta bien?" — la [auditoría 2026-07-09](auditoria-2026-07-09.md) demostró que la justa a secas castiga artefactos (columnas de más, empates, redondeos) que ningún humano llamaría fallo. Regla práctica: la equivalencia **nunca se cita sola**; va siempre con la justa al lado.
2. **La equivalencia solo puede RESCATAR, nunca descartar.** Es `justa OR juez`: el LLM juez suma aciertos que la comparación de filas descarta por un artefacto, pero no puede quitar los que la ejecución ya da por buenos. Por diseño es siempre ≥ la justa, y su falibilidad queda auditable en el detalle por caso (`equivalenceReason`).
3. **Con pocos casos, ignora la equivalencia entre modos.** En el experimento de confusión son 6 casos: cada uno vale ~17%, así que una diferencia de un caso no significa nada. Ahí mira **recall y justa**. (Ejemplo real que confundió: "solo vectorial" salía con más equivalencia que GraphRAG por *un* caso rescatado por el juez, mientras la justa era idéntica y el recall de GraphRAG era mayor — el GraphRAG era mejor, no peor.)
4. **Una sola tirada baila.** La generación del LLM no es determinista: entre tiradas el mismo caso puede cambiar ±varios puntos. Por eso la prueba de escala se reporta como **media de 5 tiradas** (`escala-tiradas.md`), no una suelta.

## Qué informe es cada cosa

- **`resumen.md`** — la portada: la tabla completa (media de 5 tiradas, las dos BDs) y las cuatro lecturas.
- **`sesgos.md`** — los sesgos y límites de las métricas (por qué tres cristales: estricta, justa, equivalencia), con el detalle de cada uno. Léelo si un número te choca o antes de citar una cifra.
- **`auditoria-2026-07-09.md`** — la auditoría caso a caso que corrigió el arnés (referencias con bugs, comparador, juez) y el antes/después de los números. **Léela antes de comparar con números antiguos.**
- **`descripciones.md`** — qué aportan las descripciones de tablas (2×2 con/sin, media de 5 tiradas), con el foco en la tabla de nombre opaco `t_042`.
- **`escala.md`** — el informe de la última tirada suelta de la prueba de escala (Arcadia 17 tablas, Nebula 66), con los tokens de contexto por modo.
- **`escala-tiradas.md`** — la media de 5 tiradas de la prueba de escala con la estabilidad por caso (el dato en el que confiar).
- **`confusion.md`** — el caso difícil: tablas y columnas con nombres opacos. Mide quién sobrevive sin descripciones.
- **`escala-coder14b.md`** — verificación con el modelo **100% local** (Qwen2.5-Coder-14B), para enseñar que la ventaja no depende de estar en la nube.
- **`escala-casos.json`** — el detalle por caso (SQL de referencia y generada, veredicto del juez), por si quieres abrir un caso concreto.
- **`tiradas/`** — los ficheros crudos de cada tirada; `tiradas/pre-auditoria/` conserva las tiradas anteriores a la corrección del arnés, como evidencia del antes.
