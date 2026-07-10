# Prueba de escala — GraphSQL

Evaluación completa (recall + execution accuracy + tamaño de contexto) sobre el golden set de cada BD.

| BD | Tablas | Casos | Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tokens de contexto |
|----|--------|-------|------|-----------------------|----------------------------|------------------------------|-------------------------------|--------------------|
| arcadia | 17 | 25 | Sin recuperación | 100% | 88% | 96% | 72% | 1498 |
| arcadia | 17 | 25 | Solo vectorial | 93% | 84% | 92% | 64% | 479 |
| arcadia | 17 | 25 | GraphRAG | 99% | 88% | 92% | 72% | 775 |
| nebula | 66 | 15 | Sin recuperación | 100% | 100% | 100% | 73% | 5748 |
| nebula | 66 | 15 | Solo vectorial | 80% | 53% | 67% | 40% | 458 |
| nebula | 66 | 15 | GraphRAG | 97% | 93% | 100% | 73% | 759 |

> Schema-linking recall: fracción de las tablas que usa la SQL de referencia que llegan al
> contexto del generador (1 = el generador tenía todas las tablas necesarias delante).
>
> Execution accuracy (justa): la SQL generada, ejecutada, contiene el resultado de referencia
> (correcta o más rica; la pregunta en NL no fija las columnas de salida). Estricta: resultado
> idéntico, cota inferior que penaliza columnas de más.
>
> El contexto de "sin recuperación" crece con el nº de tablas del esquema; el del GraphRAG se
> mantiene acotado, con recall alto. La execution accuracy es de una sola tirada (la generación
> no es determinista); los datos de Nebula son sintéticos y ligeros (validan la resolución
> pregunta→SQL, no un volumen realista).
>
> Equivalencia semántica (LLM): un segundo LLM juzga si la SQL candidata responde a la MISMA
> pregunta que la de referencia, viendo las dos SQL y una muestra de sus resultados ejecutados
> (con la candidata ejecutable como precondición). Criterio único: un caso cuenta como
> equivalente si pasa la execution accuracy (justa) O el juez lo rescata; el juez solo RECUPERA
> aciertos que la comparación de datos descarta (empates, columnas de más, agregaciones
> equivalentes), nunca descarta lo que la ejecución ya da por bueno, así que la equivalencia es
> siempre ≥ justa. Como se apoya en un LLM, es COMPLEMENTARIA, no sustituye a la objetiva. El detalle
> por caso está en `escala-casos.json`: `recall` y los dos `executionMatch` son estas mismas
> métricas a nivel de caso, y `equivalenceReason` es la justificación textual del juez.
