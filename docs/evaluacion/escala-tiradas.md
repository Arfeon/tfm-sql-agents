# Prueba de escala — media de varias tiradas

Media y rango (mín–máx) sobre **5 tiradas completas** de `npm run evaluate:scale`
(la generación no es determinista; una sola tirada baila varios puntos).

| BD | Modo | Recall (media) | Exec. justa (media) | Exec. justa (rango) | Equiv. LLM (media) | Equiv. LLM (rango) |
|----|------|----------------|---------------------|---------------------|--------------------|--------------------|
| arcadia | Sin recuperación | 100% | **73%** | 68%–76% | 74% | 68%–80% |
| arcadia | Solo vectorial | 93% | **66%** | 64%–68% | 63% | 56%–72% |
| arcadia | GraphRAG | 99% | **67%** | 64%–72% | 74% | 64%–80% |
| nebula | Sin recuperación | 100% | **68%** | 67%–73% | 85% | 80%–87% |
| nebula | Solo vectorial | 80% | **60%** | 60%–60% | 59% | 53%–67% |
| nebula | GraphRAG | 100% | **72%** | 67%–80% | 89% | 73%–100% |

## Estabilidad por caso (modo GraphRAG)

**arcadia** — aciertan siempre: G-01, G-02, G-03, G-04, G-05, G-08, G-09, G-10, G-11, G-13, G-14, G-16, G-24, G-25 · fallan siempre: G-06, G-07, G-12, G-19, G-20, G-21, G-22 · bailan entre tiradas: G-15 (4/5), G-17 (3/5), G-18 (4/5), G-23 (3/5)

**nebula** — aciertan siempre: N-01, N-02, N-03, N-04, N-05, N-08, N-10, N-11, N-12, N-14 · fallan siempre: N-06, N-07 · bailan entre tiradas: N-09 (2/5), N-13 (1/5), N-15 (1/5)

> Los casos que "bailan" son el ruido de la no-determinación del LLM: la media es más fiable
> que cualquier tirada suelta. Los que fallan SIEMPRE son los deficits reales del sistema (o de
> la referencia): son los que merecen mirarse a mano. Métrica "justa" = la candidata contiene
> el resultado de referencia; "equiv." = un LLM juez la da por equivalente (complementaria).
