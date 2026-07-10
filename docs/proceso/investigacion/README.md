# Notas de investigación

Notas que capturan, por cada pieza del proyecto, **por qué y cómo encaja** y las **dudas / cuestiones de diseño abiertas**. Material para la memoria (apartado "desarrollo y dificultades") y justificación de los commits `docs(research):`.

Incluye tanto las tecnologías base (su encaje y cuestiones abiertas) como lo **genuinamente nuevo** (el enfoque GraphRAG para SQL, la evaluación, la iteración de prompts). La **decisión formal y resumida** de cada tecnología vive en [`docs/design/arquitectura.md`](../../design/arquitectura.md) §7; aquí está el razonamiento completo y las dudas.

**Convención de commit**: `docs(research): <tema>`.

## Índice

- [LangGraph](langgraph.md) — por qué y cómo encaja, alternativas valoradas (ADK, n8n, AutoGPT/ReAct) + dudas
- [Neo4j](neo4j.md) — por qué y cómo encaja + dudas
- [Stack en TypeScript](stack-typescript.md) — confirmar la cadena completa en TS y la decisión frente a Python
- [Embeddings](embeddings.md) — proveedor y modelo para la vectorización del esquema
- [Infraestructura y despliegue](infraestructura-despliegue.md) — local vs cloud managed; por qué docker compose on-premise
- [CLI y herramientas](cli-herramientas.md) — librerías del terminal interactivo
- [Recuperación por capas](recuperacion-por-capas.md) — por qué el top-K vectorial se rompe a escala y cómo llegué a las cuatro capas (el aprendizaje central del proyecto)
- _(pendiente: evaluación, prompts…)_
