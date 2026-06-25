# Especificación de Implementación (SDD) — GraphSQL

> 🌱 **Documento incremental.** SDD aplicado de forma incremental: **cada componente se especifica justo antes de implementarlo** (*spec-first* por slice), no todo de golpe.

---

## 1. Principios rectores (metodología del curso)

Fijo estos principios **desde el inicio** porque son mi metodología de trabajo, no conocimiento del dominio técnico:

- **SDD (Spec-Driven Development)**: ningún componente se implementa sin su spec y sus criterios de aceptación; el alcance cambia editando la spec primero.
- **Clean Architecture**: dependencias hacia el dominio; el exterior (LLM, Neo4j, BD…) se accede mediante **puertos** implementados por **adaptadores** → todo testeable con dobles.
- **Clean Code**: nombres reveladores, funciones pequeñas, *type hints*, inyección de dependencias, sin números mágicos.
- **Seguridad por diseño**: solo lectura, allowlist, detección de inyección, aprobación humana, usuario de BD sin escritura.
- **TDD**: ciclo rojo → verde → refactor; un test por criterio de aceptación; nomenclatura `<unidad>_<condición>_<resultado>`.

## 2. Contexto y stack (visión general)

- **Lenguaje**: TypeScript (Node.js 20+). **Orquestación**: LangGraph.js. **Grafo**: Neo4j. **Memoria/checkpoints**: PostgreSQL + pgvector. **LLM**: configurable. **Interfaz**: CLI. **Tests**: Vitest.

## 3. Decisiones de diseño (D-xx)

> Las registro **a medida que las cierro**, con su justificación. (Plantilla: `D-NN | decisión | valor | estado`.)

| ID | Decisión | Justificación | Estado |
|----|----------|---------------|--------|
| D-01 | Stack: TypeScript + Node.js 20 | Más experiencia con el lenguaje; LangGraph.js cubre el mismo surface que necesito; la toolchain Node.js simplifica el entorno de desarrollo en Windows | ✅ Cerrada |
| D-02 | Puerto `ITargetDatabase` para la BD objetivo | Desacopla los agentes del driver `pg`; permite sustituir el adaptador en tests sin Docker; sigue el principio de inversión de dependencias de Clean Architecture | ✅ Cerrada |
| D-03 | Puerto `IChatModel` + factory para el proveedor LLM | Desacopla los agentes del proveedor concreto (OpenAI vs local); el factory centraliza qué adaptador instanciar según `LLM_PROVIDER`; mismo patrón puerto/adaptador que D-02 → testeable con dobles | ✅ Cerrada |
| D-04 | Cliente `ChatOpenAI` (LangChain) para ambos proveedores | LM Studio expone una API compatible con OpenAI: el mismo cliente sirve para la nube y para local cambiando solo `baseURL`; además es el cliente que reutilizaré al orquestar con LangGraph.js, así evito migrar después | ✅ Cerrada |

## 4. Especificaciones de componentes


| ID | Componente | Estado |
|----|-----------|--------|
| SPEC-00 | Infraestructura: BD objetivo (puerto + adaptador Postgres) | ✅ Cerrada |
| SPEC-00B | Infraestructura: proveedor LLM (puerto `IChatModel` + factory) | ✅ Cerrada |
| SPEC-01 | Supervisor (enrutador determinista) | ⏳ Pendiente |
| SPEC-02 | Memory Agent | ⏳ Pendiente |
| SPEC-03 | Schema Agent (GraphRAG) | ⏳ Pendiente |
| SPEC-04 | SQL Agent | ⏳ Pendiente |
| SPEC-05 | Judge Agent (seguridad + LLM) | ⏳ Pendiente |
| SPEC-06 | Human Review (interrupt) | ⏳ Pendiente |
| SPEC-07 | Execute SQL | ⏳ Pendiente |
| SPEC-08 | Store Feedback | ⏳ Pendiente |
| SPEC-09 | CLI | ⏳ Pendiente |

---

### SPEC-00 — Conexión a la base de datos objetivo

**Objetivo.** Necesito una forma de que los agentes puedan consultar la base de datos sin que les importe si por debajo hay un `pg.Client` o cualquier otra cosa: dependen de una interfaz, no del driver.

**Contrato.** El puerto que conocerán los agentes —`fetchAll` para ejecutar cualquier SELECT y devolver las filas, y `rowCount` para contar registros de una tabla:

```typescript
interface ITargetDatabase {
  fetchAll<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  rowCount(table: string): Promise<number>
}
```

**Pasos**

1. Definir el puerto `ITargetDatabase` (`fetchAll`, `rowCount`).
2. Implementar el adaptador `PostgresTargetDatabase` que, al conectarse, fuerce la sesión en modo READ ONLY: aunque un agente cometa un error y trate de escribir, Postgres lo bloqueará a nivel de sesión antes de ejecutarlo.
3. Levantar la infraestructura con Docker Compose (Postgres + pgvector) y cargar el dataset Arcadia al arrancar el contenedor.
4. Escribir la suite de tests diagnóstico (Vitest) que verifique los criterios de abajo: conexión, bases de datos, pgvector, solo-lectura, esquema/conteos y ausencia de anomalías.

**Criterios de aceptación**

- [X] Tras `docker compose up -d`, el servidor Postgres responde
- [X] Existen las dos bases de datos que necesito: `arcadia` y `graphsql_memory`
- [X] pgvector está activo en `arcadia` (lo necesitaré más adelante para la memoria semántica)
- [X] La conexión a `arcadia` es de solo lectura: un INSERT debe fallar
- [X] El esquema de Arcadia tiene las 16 tablas esperadas
- [X] `game` tiene `developer_company_id` y `publisher_company_id` como columnas separadas
- [X] Los conteos de filas cuadran con el seed (`game`=320, `customer`=5000, etc.)
- [X] Los datos no tienen anomalías: age ratings válidos, sesiones con duración positiva, ratings entre 1 y 5

```bash
docker compose up -d
cd backend && npm test
```

---

### SPEC-00B — Proveedor de modelo LLM (puerto + factory)

**Objetivo.** Todos los agentes van a necesitar hablar con un LLM, y quiero poder elegir entre la API de OpenAI (nube) y un modelo local servido por LM Studio sin que los agentes se enteren del cambio. Es la misma idea que `ITargetDatabase`: el agente depende de una interfaz, no del proveedor concreto.

**Contrato.** El puerto que conocerán los agentes —recibe una conversación (mensajes de sistema/usuario/asistente) y devuelve el texto de la respuesta:

```typescript
type ChatRole = 'system' | 'user' | 'assistant'
interface ChatMessage { role: ChatRole; content: string }

interface IChatModel {
  chat(messages: ChatMessage[]): Promise<string>
}
```

**Pasos**

1. Crear el `enum LlmProvider` con los proveedores disponibles (`OpenAI`, `Local`); el valor de cada miembro será la cadena que espero en `LLM_PROVIDER`.
2. Definir el puerto `IChatModel` (`chat(messages) → texto`).
3. Implementar dos adaptadores separados, `OpenAIChatModel` y `LocalChatModel`, cada uno con un `fromEnv()` que lea **su propia** config del entorno (igual que `PostgresTargetDatabase.fromParams`). Como LM Studio expone una API compatible con OpenAI, ambos envolverán el mismo cliente `ChatOpenAI` de LangChain y el local solo cambiará el `baseURL`. Los mantengo separados para que el patrón quede explícito y poder añadir mañana un proveedor no compatible (Anthropic, Ollama nativo…) sin tocar a los agentes.
4. Crear el factory `ChatModelFactory` que, según el proveedor, construya **solo** ese adaptador (`create(provider)` y `fromEnv()` leyendo `LLM_PROVIDER`); un proveedor desconocido lanzará un error que liste los válidos.
5. Escribir los tests unitarios del factory: `OpenAI` → adaptador OpenAI, `Local` → adaptador local, desconocido → error.
6. Escribir el smoke test de integración (opt-in): enviar «Hola, dime hola» contra el LLM real y comprobar que responde; se salta si faltan credenciales.

**Criterios de aceptación**

- [X] Con `LlmProvider.OpenAI`, el factory crea un adaptador de OpenAI
- [X] Con `LlmProvider.Local`, el factory crea un adaptador local (LM Studio)
- [X] Con un proveedor desconocido, el factory lanza un error claro que lista los válidos
- [X] La config se resuelve desde el entorno (`LLM_PROVIDER`, `OPENAI_*`, `LMSTUDIO_*`); `LLM_TEMPERATURE` vacía no se envía al modelo (la familia gpt-5 solo acepta el valor por defecto)
- [X] *Smoke test*: con el proveedor activo, enviar «Hola, dime hola» devuelve una respuesta de texto no vacía
- [X] El *smoke test* es opt-in y se salta si faltan credenciales, para que `npm test` quede siempre verde y offline

```bash
cd backend && npm test              # unitarios del factory (sin red)
cd backend && npm run test:integration   # smoke test contra el LLM real (opt-in)
```


