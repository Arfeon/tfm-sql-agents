# Experimento de confusión — tablas Y columnas opacas (SPEC-21, fase dura)

Seis tablas de Nebula renombradas al mismo patrón opaco (t_ops_01, t_ops_02, t_ops_03, t_ops_04, t_ops_05, t_ops_06)
y sus COLUMNAS renombradas a c1..c5 (mismo patrón en todas, como un ERP legacy): sin descripciones
no habla nada — ni el nombre ni las columnas; quedan los tipos y las claves foráneas (estructura).
En la fase 1 (solo nombre de tabla opaco) el recall aguantó ~100% porque las columnas delataban el
propósito; esta fase cierra esa vía. Preguntas que solo se responden con estas tablas, evaluadas
con y sin descripciones (la descripción mapea las columnas, como documentaría un data steward).

| Descripciones | Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia (LLM) |
|---------------|------|-----------------------|----------------------------|--------------------|
| con | Sin recuperación | 100% | 17% | 17% |
| con | Solo vectorial | 83% | 33% | 50% |
| con | GraphRAG | 100% | 50% | 83% |
| sin | Sin recuperación | 100% | 17% | 33% |
| sin | Solo vectorial | 8% | 0% | 0% |
| sin | GraphRAG | 17% | 0% | 0% |

## Detalle por caso (¿apareció la tabla ofuscada en el contexto? / ¿acertó?)

| Condición | C-01 | C-02 | C-03 | C-04 | C-05 | C-06 |
|-----------|----|----|----|----|----|----|
| con · Sin recuperación | sí / ✗ | sí / ✗ | sí / ✗ | sí / ✗ | sí / ✓ | sí / ✗ |
| con · Solo vectorial | sí / ✗ | sí / ✓ | sí / ✓ | sí / ✗ | sí / ✗ | sí / ✗ |
| con · GraphRAG | sí / ✗ | sí / ✓ | sí / ✓ | sí / ✗ | sí / ✓ | sí / ✗ |
| sin · Sin recuperación | sí / ✗ | sí / ✗ | sí / ✗ | sí / ✗ | sí / ✓ | sí / ✗ |
| sin · Solo vectorial | no / ✗ | no / ✗ | no / ✗ | no / ✗ | no / ✗ | no / ✗ |
| sin · GraphRAG | no / ✗ | no / ✗ | no / ✗ | no / ✗ | no / ✗ | no / ✗ |

> Contexto: el benchmark normal es amable con la baseline (nombres autoexplicativos, sesgo #5 de
> arquitectura §10). Aquí se mide qué pasa cuando el nombre no ayuda: cuánto pierden los modos sin
> descripciones, cuánto rescatan las descripciones, y si el grafo salva las multi-hop (C-05, C-06)
> por la clave foránea, como hizo con t_042. En "sin recuperación" el esquema entero viaja igual;
> lo que cambia es si el DDL lleva el comentario de descripción.
