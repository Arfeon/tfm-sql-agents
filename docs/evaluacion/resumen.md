# Evaluación experimental (ablation) — GraphSQL

BD objetivo: postgresql / arcadia. Casos: 25.

| Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tablas de contexto | Tokens de contexto |
|------|----------------------|----------------------------|------------------------------|-------------------------------|--------------------|--------------------|
| Sin recuperación | 100% | 72% | 88% | 16% | 17.0 | 1498 |
| Solo vectorial | 93% | 68% | 84% | 24% | 5.0 | 481 |
| GraphRAG | 99% | 64% | 80% | 28% | 8.0 | 774 |

> Schema-linking recall: fracción de las tablas que usa la SQL de referencia que llegan al
> contexto del generador (1 = el generador tenía todas las tablas necesarias delante).
>
> Execution accuracy (justa): la SQL generada, ejecutada, contiene el resultado de referencia
> (correcta o más rica; la pregunta en NL no fija las columnas de salida). Estricta: resultado
> idéntico, cota inferior que penaliza columnas de más.
>
> Equivalencia semántica (LLM): un segundo LLM juzga si la candidata responde a la MISMA
> pregunta que la de referencia (con la candidata ejecutable como precondición). Criterio único: un
> caso cuenta como equivalente si pasa la execution accuracy (justa) O el juez lo rescata; el juez
> solo RECUPERA aciertos que la comparación de datos descarta (empates, columnas de más, agregaciones
> equivalentes), nunca descarta lo que la ejecución ya da por bueno (la equivalencia es siempre ≥
> justa). El juez también se equivoca: es COMPLEMENTARIA, no sustituye a la objetiva.
>
> Límites: golden set pequeño (un solo dominio, un solo modelo), una única tirada por caso
> (la generación no es determinista). A la escala de Arcadia la baseline "sin recuperación"
> aún cabe en el contexto, así que el argumento lo carga el tamaño de contexto/tokens; la
> brecha de execution accuracy se espera que crezca con esquemas mayores.
