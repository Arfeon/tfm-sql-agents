# Resumen de la evaluación — GraphSQL

La foto completa, en una tabla: **media de 5 tiradas** de la prueba de escala (chat `gpt-5-mini`,
embeddings locales `bge-m3`), con el arnés corregido tras la [auditoría 2026-07-09](auditoria-2026-07-09.md).
La métrica que responde a "¿el sistema contesta bien?" es la **equivalencia**; la "justa" es su
cota inferior objetiva (comparación de resultados ejecutados, sin LLM juez). Detalle y rangos en
[escala-tiradas.md](escala-tiradas.md); el porqué de cada métrica, en [arquitectura.md §10](../design/arquitectura.md).

| BD (tablas) | Modo | Recall | Exec. justa | **Equivalencia** | Tokens de contexto |
|---|---|---|---|---|---|
| arcadia (17) | Sin recuperación | 100% | 87% | 96% | 1.498 |
| arcadia (17) | Solo vectorial | 93% | 84% | 88% | 479 |
| arcadia (17) | **GraphRAG** | 99% | **88%** | **94%** | **775** |
| nebula (66) | Sin recuperación | 100% | 100% | 100% | 5.748 |
| nebula (66) | Solo vectorial | 80% | 59% | 67% | 458 |
| nebula (66) | **GraphRAG** | 97% | **93%** | **99%** | **759** |

## Las cuatro lecturas

1. **El contexto del GraphRAG es plano; el del esquema entero, lineal.** De 17 a 66 tablas el
   DDL completo se multiplica por ~3,8 (1.498 → 5.748 tokens); el del GraphRAG no se mueve
   (775 → 759). Y el esquema viaja en **cada llamada del bucle** (generación, juez, reintentos,
   afinados: 6-8 por pregunta), así que el ahorro de ~7,6× se multiplica en cada consulta.
2. **En calidad, GraphRAG empata con la baseline gastando una fracción.** A 66 tablas, el
   esquema entero con un modelo de nube potente es perfecto (100%) — y GraphRAG se queda a un
   punto de equivalencia (99%, rango 93–100) con 7,6× menos contexto. A 17 tablas incluso
   queda por delante en la métrica justa (88% vs 87%, rangos solapados: empate honesto).
3. **El grafo no es decoración: la búsqueda vectorial sola se hunde a escala.** De 17 a 66
   tablas su recall cae de 93% a 80% (pierde las tablas de los JOIN) y su acierto a 59%.
   La expansión por FK es lo que sostiene el recall del GraphRAG (97-99%).
4. **Las descripciones y el grafo se refuerzan** ([descripciones.md](descripciones.md), media
   de 5 tiradas): GraphRAG supera al vectorial en las cuatro celdas del 2×2, y el caso extremo
   ([confusion.md](confusion.md)) muestra que con el esquema opaco la recuperación es la
   diferencia entre usable e inusable.

## Dónde gana de verdad (y dónde solo empata)

En una BD pequeña y con un modelo de nube grande, volcar el esquema funciona — ahí GraphSQL
"solo" iguala la calidad gastando la mitad. Su ventaja se abre con los ejes que en producción
son la norma: **esquemas grandes** (coste y latencia lineales vs planos), **modelos locales**
(el contexto acotado es lo que hace viable un 14B en hardware de consumo — [escala-coder14b.md](escala-coder14b.md)),
y **esquemas opacos** (el experimento de confusión). Los límites y sesgos declarados, en
[auditoría](auditoria-2026-07-09.md) y [arquitectura.md §10](../design/arquitectura.md).

> Los fallos persistentes que quedan son dos artefactos de métrica rescatados por la
> equivalencia (G-25 y N-13, empates/columnas equivalentes) y un déficit real documentado:
> G-21, la tabla a dos saltos que la expansión de un salto no alcanza (mejora especificada
> en SPEC-22).
