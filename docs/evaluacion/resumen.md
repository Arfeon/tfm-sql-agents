# Evaluación experimental (ablation) — GraphSQL

BD objetivo: postgresql / arcadia. Casos: 25.

| Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tablas de contexto | Tokens de contexto |
|------|----------------------|----------------------------|------------------------------|-------------------------------|--------------------|--------------------|
| Sin recuperación | 100% | 72% | 64% | 16% | 17.0 | 1498 |
| Solo vectorial | 93% | 68% | 60% | 24% | 5.0 | 481 |
| GraphRAG | 99% | 64% | 56% | 28% | 8.0 | 774 |

> Execution accuracy (justa): la SQL generada, ejecutada, contiene el resultado de referencia
> (correcta o más rica; la pregunta en NL no fija las columnas de salida). Estricta: resultado
> idéntico, cota inferior que penaliza columnas de más.
>
> Equivalencia semántica (LLM): un segundo LLM juzga si la candidata responde a la MISMA
> pregunta que la de referencia (con la candidata ejecutable como precondición). Captura aciertos
> que la comparación de resultados descarta (empates, columnas de más, agregaciones equivalentes),
> pero el juez también se equivoca: es una métrica COMPLEMENTARIA, no sustituye a la objetiva.
>
> Límites: golden set pequeño (un solo dominio, un solo modelo), una única tirada por caso
> (la generación no es determinista). A la escala de Arcadia la baseline "sin recuperación"
> aún cabe en el contexto, así que el argumento lo carga el tamaño de contexto/tokens; la
> brecha de execution accuracy se espera que crezca con esquemas mayores.
