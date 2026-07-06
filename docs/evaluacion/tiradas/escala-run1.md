# Prueba de escala — GraphSQL

Evaluación completa (recall + execution accuracy + tamaño de contexto) sobre el golden set de cada BD.

| BD | Tablas | Casos | Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tokens de contexto |
|----|--------|-------|------|-----------------------|----------------------------|------------------------------|-------------------------------|--------------------|
| arcadia | 17 | 25 | Sin recuperación | 100% | 68% | 68% | 20% | 1498 |
| arcadia | 17 | 25 | Solo vectorial | 93% | 68% | 56% | 24% | 481 |
| arcadia | 17 | 25 | GraphRAG | 99% | 68% | 64% | 20% | 774 |
| nebula | 66 | 15 | Sin recuperación | 100% | 67% | 80% | 20% | 5748 |
| nebula | 66 | 15 | Solo vectorial | 80% | 60% | 53% | 27% | 457 |
| nebula | 66 | 15 | GraphRAG | 100% | 80% | 73% | 40% | 759 |

> El contexto de "sin recuperación" crece con el nº de tablas del esquema; el del GraphRAG se
> mantiene acotado, con recall alto. La execution accuracy es de una sola tirada (la generación
> no es determinista); los datos de Nebula son sintéticos y ligeros (validan la resolución
> pregunta→SQL, no un volumen realista).
>
> Equivalencia semántica (LLM): un segundo LLM juzga si la SQL candidata responde a la MISMA
> pregunta que la de referencia (con la candidata ejecutable como precondición). Recupera aciertos
> que la comparación de resultados descarta (empates, columnas de más, agregaciones equivalentes);
> como se apoya en un LLM, es COMPLEMENTARIA a la execution accuracy, no la sustituye. El detalle
> por caso (SQL generada y motivo del juez) está en `escala-casos.json`.
