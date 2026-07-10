# Prueba de escala — media de varias tiradas

Media y rango (mín–máx) sobre **5 tiradas completas** de `npm run evaluate:scale`
(la generación no es determinista; una sola tirada baila varios puntos).

| BD | Modo | Recall (media) | Exec. justa (media) | Exec. justa (rango) | Equiv. LLM (media) | Equiv. LLM (rango) |
|----|------|----------------|---------------------|---------------------|--------------------|--------------------|
| arcadia | Sin recuperación | 100% | **87%** | 84%–92% | 96% | 92%–100% |
| arcadia | Solo vectorial | 93% | **84%** | 80%–88% | 88% | 84%–92% |
| arcadia | GraphRAG | 99% | **88%** | 84%–92% | 94% | 88%–96% |
| nebula | Sin recuperación | 100% | **100%** | 100%–100% | 100% | 100%–100% |
| nebula | Solo vectorial | 80% | **59%** | 53%–60% | 67% | 60%–73% |
| nebula | GraphRAG | 97% | **93%** | 93%–93% | 99% | 93%–100% |

## Estabilidad por caso (modo GraphRAG)

**arcadia** — aciertan siempre: G-01, G-02, G-03, G-04, G-05, G-06, G-07, G-08, G-09, G-10, G-11, G-12, G-13, G-14, G-15, G-19, G-20, G-22, G-23, G-24 · fallan siempre: G-21, G-25 · bailan entre tiradas: G-16 (4/5), G-17 (4/5), G-18 (2/5)

**nebula** — aciertan siempre: N-01, N-02, N-03, N-04, N-05, N-06, N-07, N-08, N-09, N-10, N-11, N-12, N-14, N-15 · fallan siempre: N-13 · bailan entre tiradas: (ninguno)

> Los casos que "bailan" son el ruido de la no-determinación del LLM: la media es más fiable
> que cualquier tirada suelta. Los que fallan SIEMPRE son los deficits reales del sistema (o de
> la referencia): son los que merecen mirarse a mano. Métrica "justa" = la candidata contiene
> el resultado de referencia (objetiva). "Equiv." = pasa la justa O el juez LLM la rescata: el
> juez solo recupera aciertos que la comparación de datos descarta (redondeos, columnas de más),
> nunca descarta lo que la ejecución ya da por bueno, así que la equivalencia es siempre ≥ justa.
