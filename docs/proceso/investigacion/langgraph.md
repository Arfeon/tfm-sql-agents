# LangGraph — por qué y cómo encaja

- **Fecha**: 2026-06-21
- **Decisión formal (resumen)**: [`docs/design/arquitectura.md`](../../design/arquitectura.md) §7

## Por qué encaja

Nuestro flujo es una **máquina de estados determinista** con un bucle de reintento y una pausa para aprobación humana. LangGraph cubre exactamente eso:

- **Nodos** = funciones que actualizan un estado compartido → un agente por nodo.
- **Aristas condicionales** = routing por reglas sobre el estado (sin LLM supervisor → más barato y predecible).
- **Checkpointers** = persistencia del estado.
- **`interrupt_before`** = pausar y reanudar → encaja con el *human-in-the-loop*.

## Alternativas valoradas

Partía de las certificaciones de LangChain Academy y de Neo4j, así que ya conocía el ecosistema; aun así, antes de decidir valoré alternativas. El criterio no fue cuál tiene más funciones, sino una pregunta más básica: **¿quién decide el siguiente paso, mis reglas o el LLM?** Este sistema ejecuta SQL contra una base de datos corporativa: no quería un agente donde el LLM planifica, quería una máquina de estados donde el flujo lo dictan mis reglas y el LLM solo trabaja dentro de cada nodo.

- **Agente ReAct / AutoGPT / deep agents** — la filosofía contraria: el LLM decide cada paso (qué herramienta usar, cuándo terminar). Indeterminista, con una llamada extra por decisión de routing, y sin forma estructural de garantizar que ninguna SQL se ejecute sin pasar por el Judge y por mi aprobación: esa garantía dependería de prompts, no de la arquitectura. Para un ejecutor de SQL, el determinismo es seguridad.
- **ADK (Agent Development Kit, Google)** — framework de agentes razonable, pero Python/Java-first (mi stack es TypeScript) y con un human-in-the-loop menos maduro que el `interrupt_before` persistente de LangGraph, que es justo la pieza central de mi flujo.
- **n8n** — plataforma visual de workflows, no una librería: la lógica vive en la herramienta, no en mi código, así que no se versiona en git, no se revisa en un diff y no se testea unitariamente. Excelente para orquestar integraciones; la abstracción equivocada cuando el pipeline ES el producto.

Lo que me dio LangGraph frente a todas: la garantía de que **nada se ejecuta sin mi aprobación no es un prompt — está en la estructura del grafo compilado** (`interrupt_before` + checkpointer), y el enrutado completo se testea como código normal, con dobles y sin LLM.

## Cómo encaja en el flujo

- Cada agente es un nodo: `memory → schema → sql → judge → human_review → execute → store`.
- Bucle de reintento `sql ↔ judge` como arista condicional sobre `retry_count`.
- `human_review` con `interrupt_before`: el estado se persiste en PostgreSQL, la CLI recoge la decisión del usuario y el grafo se reanuda donde se detuvo.

## Dudas / cuestiones de diseño abiertas

- ¿*Checkpointer* en memoria para los tests y PostgreSQL para la ejecución real? Cómo se configura el *saver* de Postgres.
- Cómo tipar el estado compartido (`TypedDict`) y qué campos exactos necesita.
- Detalle de la reanudación (`update_state`) tras el `interrupt` y cómo se integra con el REPL de la CLI.
