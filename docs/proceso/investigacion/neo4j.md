# Neo4j — por qué y cómo encaja

- **Fecha**: 2026-06-21
- **Decisión formal (resumen)**: [`docs/design/arquitectura.md`](../../design/arquitectura.md) §7

## Por qué encaja

El esquema de una base de datos relacional **ya es un grafo** (tablas unidas por claves foráneas). Modelarlo en Neo4j aporta:

- **Expansión por FK**: desde una tabla candidata, recorrer sus relaciones para incluir las tablas necesarias para los JOINs.
- **Soporte multilingüe**: nodos de descripción/concepto que conectan sinónimos (`pedido` ↔ `order`), difícil con esquema en texto plano.
- **Recorridos naturales** con Cypher, que escalan mejor en bases grandes que volcar todo el esquema como texto.

Se **combina con pgvector**: vector para encontrar tablas candidatas (mapeo semántico), grafo para expandir por relaciones. Cada uno resuelve un problema distinto.

## Cómo encaja en el flujo

- Modelo: `(:Table)-[:HAS_COLUMN]->(:Column)`, `(:Table)-[:REFERENCES]->(:Table)`, `(:Table)-[:DESCRIBED_BY]->(:Description)-[:RELATED_TO]->(:Concept)`.
- Schema Agent: pgvector encuentra tablas candidatas → Cypher expande por `REFERENCES` → se genera el DDL solo con las tablas relevantes.

## Dudas / cuestiones de diseño abiertas

- **Ingesta**: cómo poblar el grafo a partir del esquema real (script de introspección de tablas/columnas/FKs).
