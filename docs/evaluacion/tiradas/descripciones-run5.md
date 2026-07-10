# Ablation de descripciones — GraphSQL

BD objetivo: postgresql / arcadia. Casos: 25.

## Comparativa 2×2 (modo × descripciones)

| Modo | Descripciones | Schema-linking recall | Execution accuracy (justa) |
|------|---------------|-----------------------|----------------------------|
| vector | con | 93% | 80% |
| graphrag | con | 99% | 88% |
| vector | sin | 86% | 64% |
| graphrag | sin | 96% | 80% |

## Foco G-25: t_042 (tabla de nombre opaco = lista de deseos)

| Modo | Descripciones | ¿t_042 recuperada? | Recall | ¿resultado correcto? |
|------|---------------|--------------------|--------|----------------------|
| vector | con | sí | 100% | no |
| graphrag | con | sí | 100% | no |
| vector | sin | sí | 50% | no |
| graphrag | sin | sí | 100% | no |

> Sin descripciones, el índice se vectoriza solo con nombre + columnas y el DDL no lleva
> el comentario de propósito. La tabla `t_042` no delata por su nombre que guarda listas
> de deseos, así que es el caso donde las descripciones deberían marcar la diferencia.
