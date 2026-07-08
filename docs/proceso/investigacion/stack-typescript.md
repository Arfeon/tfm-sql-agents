# Stack en TypeScript — LangGraph + Neo4j en TS

- **Fecha**: 2026-06-22
- **Objetivo**: confirmar que puedo construir el proyecto (LangGraph + Neo4j + Postgres/pgvector) en TypeScript, el lenguaje con el que más cómodo me siento.

## Qué he leído / probado

- **LangGraph.js** — port oficial mantenido por LangChain. Paquete de construcción de grafos: `@langchain/langgraph` (≠ `@langchain/langgraph-sdk`, que es solo el cliente para hablar con un servidor LangGraph). Repo: https://github.com/langchain-ai/langgraphjs · Docs: https://docs.langchain.com/oss/javascript/langgraph/overview
- **Neo4j JavaScript driver** — driver oficial de primera parte `neo4j-driver`, con tipos TypeScript incluidos en el propio paquete (exporta `Node`, `Relationship`, etc.). Requiere Node 18+. Docs: https://neo4j.com/docs/javascript-manual/current/
- **Checkpointer Postgres en JS** — `@langchain/langgraph-checkpoint-postgres`, suficiente para el MVP con pgvector.
- **Embeddings** — disponibles en JS vía `@langchain/openai`.

## Qué he aprendido

- LangGraph.js cubre el núcleo que necesito: `StateGraph`, aristas condicionales (routing por reglas), *checkpointers* para persistencia e `interrupt`/`interrupt_before` para el human-in-the-loop.
- El driver de Neo4j en TS es de primera parte y está tipado → buena experiencia de desarrollo.
- Toda la cadena (grafo + Neo4j + Postgres/pgvector + embeddings) tiene equivalente oficial en JS/TS.

## Dudas / cosas que no me han quedado claras

- **Madurez del ecosistema**: la comunidad, tutoriales y ejemplos avanzados de LangGraph son mayoritariamente Python. El *core* está en JS, pero hay menos material.
- **Checkpointer + pgvector en JS**: confirmar que `@langchain/langgraph-checkpoint-postgres` + pgvector + embeddings funcionan de punta a punta.
- **Paridad de features**: ¿va LangGraph.js a la par de la versión Python o por detrás en funcionalidades nuevas?

## Decisión

**Me quedo en TypeScript.** Toda la cadena tiene equivalente oficial en JS/TS. El ecosistema está lo suficientemente maduro para el alcance del TFM: `@langchain/langgraph` cubre `StateGraph`, aristas condicionales y human-in-the-loop; `neo4j-driver` está tipado de serie; el checkpointer Postgres existe y es suficiente para el MVP. Prefiero programar con el lenguaje con el que más cómodo me siento y aprovechar el tipado estático — con la complejidad de un sistema multi-agente, los contratos entre nodos se hacen explícitos en compilación en lugar de fallar en ejecución.
