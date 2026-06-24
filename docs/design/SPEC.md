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

## 4. Especificaciones de componentes

> Redacto cada `SPEC-NN` **antes** de implementar su componente, con: contrato (entradas/salidas), criterios de aceptación (*Given/When/Then*) y la lista de tests (TDD). Orden previsto en [PLANNING.md](../../PLANNING.md).

| ID | Componente | Estado |
|----|-----------|--------|
| SPEC-00 | Infraestructura: BD objetivo (puerto + adaptador Postgres) | ✅ Cerrada |
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

Necesito una forma de que los agentes puedan consultar la base de datos sin que les importe si por debajo hay un `pg.Client` o cualquier otra cosa. Para eso defino el puerto `ITargetDatabase` con solo dos métodos: `fetchAll` para ejecutar cualquier SELECT y devolver las filas, y `rowCount` para contar registros de una tabla. Los agentes solo conocen esta interfaz.

El adaptador concreto será `PostgresTargetDatabase`. Al conectarse forzará la sesión en modo READ ONLY, así aunque algún agente cometa un error y trate de escribir, Postgres lo bloqueará a nivel de sesión antes de que llegue a ejecutarse.

```typescript
interface ITargetDatabase {
  fetchAll<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  rowCount(table: string): Promise<number>
}
```

**Criterios de aceptación**

- [X] Levanto `docker compose up -d` y el servidor Postgres responde
- [X] Las dos bases de datos que necesito existen: `arcadia` y `graphsql_memory`
- [X] pgvector está activo en `arcadia` (lo necesito más adelante para la memoria semántica)
- [X] La conexión a `arcadia` es realmente de solo lectura — si intento un INSERT tiene que fallar
- [X] El esquema de Arcadia tiene las 16 tablas esperadas
- [X] `game` tiene `developer_company_id` y `publisher_company_id` como columnas separadas
- [X] Los conteos de filas cuadran con el seed (`game`=320, `customer`=5000, etc.)
- [X] Los datos no tienen anomalías: age ratings válidos, sesiones con duración positiva, ratings entre 1 y 5

```bash
docker compose up -d
cd backend && npm test
```


