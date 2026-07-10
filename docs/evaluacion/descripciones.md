# Ablation de descripciones — media de 5 tiradas

BD objetivo: postgresql / arcadia. Casos: 25. Media y rango (mín–máx) sobre **5 tiradas completas**
de `npm run evaluate:descriptions`, con el arnés corregido tras la [auditoría 2026-07-09](auditoria-2026-07-09.md).
Los `.md` de cada tirada están en `tiradas/descripciones-run*.md`.

## Comparativa 2×2 (modo × descripciones)

| Modo | Descripciones | Schema-linking recall | Exec. justa (media) | Exec. justa (rango) |
|------|---------------|-----------------------|---------------------|---------------------|
| vector | con | 93% | 81% | 76%–88% |
| **graphrag** | **con** | **99%** | **89%** | 84%–92% |
| vector | sin | 86% | 65% | 64%–68% |
| **graphrag** | **sin** | **96%** | **82%** | 80%–84% |

Tres lecturas, ahora con medias en vez de golpes de tirada:

1. **El grafo aporta en las cuatro celdas.** GraphRAG supera a la búsqueda vectorial sola tanto
   con descripciones (89% vs 81%) como sin ellas (82% vs 65%). Una versión anterior de este
   documento (una sola tirada) mostraba lo contrario en una celda; era ruido de tirada única
   más los sesgos del arnés corregidos en la auditoría.
2. **Las descripciones aportan a los dos modos**: +8 puntos al GraphRAG (82→89) y +16 a la
   búsqueda vectorial (65→81). Donde más se nota es sin grafo, porque el vector no tiene otra
   vía para encontrar lo que el nombre no dice.
3. **Las dos piezas se cubren la espalda**: el peor caso del GraphRAG (sin descripciones, 82%)
   sigue por encima del mejor caso del vector solo (81%).

## Foco G-25: t_042 (tabla de nombre opaco = lista de deseos)

Estable en las 5 tiradas:

| Modo | Descripciones | ¿t_042 recuperada? | Recall del caso |
|------|---------------|--------------------|-----------------|
| vector | con | sí | 100% |
| graphrag | con | sí | 100% |
| vector | sin | sí | 50% |
| graphrag | sin | sí | 100% |

El grafo rescata el contexto completo de `t_042` incluso sin descripciones (la trae la FK con
`customer`); el vector solo, sin descripciones, se deja la mitad del contexto. El **resultado**
de G-25 falla la métrica justa en este ablation por el empate en el corte del top-5 (varios
clientes con el mismo número de deseos; documentado en la auditoría) — en la prueba de escala
la métrica de equivalencia lo rescata de forma consistente.

> Sin descripciones, el índice se vectoriza solo con nombre + columnas y el DDL no lleva
> el comentario de propósito. La tabla `t_042` no delata por su nombre que guarda listas
> de deseos, así que es el caso donde las descripciones deberían marcar la diferencia.
