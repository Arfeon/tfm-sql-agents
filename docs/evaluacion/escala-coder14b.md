# Verificación 100% local (Qwen2.5-Coder-14B) — media de 3 tiradas

La misma prueba de escala, ejecutada **entera en local** (chat `qwen2.5-coder-14b-instruct` +
embeddings `bge-m3` en LM Studio, hardware de consumo), con el arnés corregido tras la
[auditoría 2026-07-09](auditoria-2026-07-09.md). Media y rango de **3 tiradas**
(los informes crudos, en `tiradas/escala-coder14b-run*.md`). La versión anterior de este
documento era una tirada única con otra metodología (sin juez LLM + revisión manual del autor),
así que sus números no son comparables con estos.

| BD | Modo | Recall | Exec. justa (rango) | Equiv. (rango) | Tokens |
|----|------|--------|---------------------|----------------|--------|
| arcadia | Sin recuperación | 100% | 61% (56–68) | 79% (76–80) | 1498 |
| arcadia | Solo vectorial | 93% | 57% (56–60) | 68% (64–72) | 479 |
| arcadia | GraphRAG | 99% | 64% (56–68) | 79% (68–88) | 775 |
| nebula | Sin recuperación | 100% | 64% (60–73) | 71% (67–80) | 5748 |
| nebula | Solo vectorial | 80% | 71% (67–73) | 73% (73–73) | 458 |
| nebula | GraphRAG | 97% | 62% (53–67) | 64% (53–73) | 759 |

## Lectura honesta

- **La ventaja del GraphRAG no depende de la nube, pero el modelo local es otro régimen.** El
  14B se queda ~20-30 puntos por debajo de gpt-5-mini en todos los modos, y con **mucha más
  varianza entre tiradas** (rangos de hasta 20 puntos con 15-25 casos): con un modelo pequeño,
  3 tiradas dibujan tendencias, no décimas.
- **En Arcadia, GraphRAG empata con el esquema entero (79% de equivalencia ambos) con la mitad
  de contexto**, y supera al vectorial solo (68%). El patrón de la nube se repite.
- **En Nebula los tres modos quedan en la misma banda (64-73%), con los rangos solapados**: a
  esta escala (5.7k tokens) el 14B todavía digiere el esquema entero, así que el argumento local
  a 66 tablas es el coste/latencia del prefill, no la viabilidad. La viabilidad pura (que el
  esquema entero *no quepa* o degrade de verdad) es el escenario de 200+ tablas (~17k tokens),
  que queda como proyección declarada, no medida.
- **Lo que sí es rotundo en local es el caso opaco** ([confusion.md](confusion.md), medido con
  este mismo modelo): GraphRAG con descripciones resuelve 4 de 6 y el esquema entero 0 de 6.
  Cuando el esquema no ayuda, la recuperación no es una optimización — es la diferencia entre
  funcionar y no.

> Recall y tokens son estables entre tiradas (no dependen del generador). La equivalencia la
> juzga aquí el propio modelo local — mismo criterio monótono (`justa OR juez`) que el resto
> de la evaluación.
