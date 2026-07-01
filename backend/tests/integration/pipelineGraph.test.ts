/**
 * Test de integración del pipeline con el checkpointer PostgreSQL (SPEC-08).
 *
 * Lo que los unitarios (con `MemorySaver`) no pueden probar: que el estado se
 * PERSISTE de verdad en `graphsql_memory` y es recuperable por `thread_id`. Para
 * aislar el checkpointer del LLM y de Neo4j, doblo los colaboradores del pipeline
 * (recuperar/generar/juzgar/ejecutar); lo real aquí es el `PostgresSaver`.
 *
 * Opt-in (`npm run test:integration`). Requiere docker compose up -d (Postgres).
 */
import { describe, it, expect } from 'vitest'
import { createSqlPipelineGraph, type PipelineDependencies } from '../../src/graphsql/graph/pipelineGraph'
import { CheckpointerFactory } from '../../src/graphsql/infrastructure/checkpoint/CheckpointerFactory'
import type { SchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'
import type { JudgeVerdict } from '../../src/graphsql/domain/sql/JudgeVerdict'

function contextFor(tableNames: string[]): SchemaContext {
  return { tables: [], tableNames, ddl: tableNames.map((name) => `CREATE TABLE ${name} (...);`).join('\n') }
}

const validVerdict: JudgeVerdict = {
  valid: true,
  confidence: 0.9,
  errors: [],
  warnings: [],
  suggestions: [],
  tablesVerified: [],
  explanation: 'ok',
}

function makeDeps() {
  const calls = { retrieveMustInclude: [] as string[][], executed: [] as string[] }
  const deps: PipelineDependencies = {
    retrieve: async (_question, mustInclude) => {
      calls.retrieveMustInclude.push(mustInclude)
      return contextFor(['customer', ...mustInclude])
    },
    generate: async () => ({ text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }),
    judge: async () => validVerdict,
    execute: async (sql) => {
      calls.executed.push(sql.text)
      return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, truncated: false }
    },
  }
  return { deps, calls }
}

const START_STATE = { question: '¿cuántos clientes?', dialect: 'PostgreSQL' }

describe('pipeline con checkpointer PostgreSQL (integración)', () => {
  it(
    'pausa antes de la revisión y persiste el estado, recuperable por thread_id',
    async () => {
      const config = { configurable: { thread_id: `spec08-persist-${Date.now()}` } }

      // Corro hasta la pausa con un grafo y su checkpointer.
      const checkpointer = await CheckpointerFactory.fromEnv()
      try {
        const graph = createSqlPipelineGraph(checkpointer, makeDeps().deps)
        await graph.invoke(START_STATE, config)
      } finally {
        await checkpointer.end()
      }

      // Un grafo y un checkpointer NUEVOS, sobre la misma BD, recuperan la pausa.
      const checkpointer2 = await CheckpointerFactory.fromEnv()
      try {
        const graph2 = createSqlPipelineGraph(checkpointer2, makeDeps().deps)
        const snapshot = await graph2.getState(config)
        expect(snapshot.next).toEqual(['human_review'])
        expect(snapshot.values.sql?.text).toBe('SELECT * FROM customer')
        expect(snapshot.values.verdict?.valid).toBe(true)
      } finally {
        await checkpointer2.end()
      }
    },
    30_000,
  )

  it(
    'reanudar-aprobar continúa a ejecutar',
    async () => {
      const checkpointer = await CheckpointerFactory.fromEnv()
      try {
        const { deps, calls } = makeDeps()
        const graph = createSqlPipelineGraph(checkpointer, deps)
        const config = { configurable: { thread_id: `spec08-approve-${Date.now()}` } }

        await graph.invoke(START_STATE, config)
        await graph.updateState(config, { decision: { action: 'approve' } })
        await graph.invoke(null, config)

        const snapshot = await graph.getState(config)
        expect(snapshot.next).toEqual([])
        expect(calls.executed).toEqual(['SELECT * FROM customer'])
        expect(snapshot.values.result?.rowCount).toBe(1)
      } finally {
        await checkpointer.end()
      }
    },
    30_000,
  )

  it(
    'reanudar-fijar-tabla rehace la recuperación con la tabla fijada',
    async () => {
      const checkpointer = await CheckpointerFactory.fromEnv()
      try {
        const { deps, calls } = makeDeps()
        const graph = createSqlPipelineGraph(checkpointer, deps)
        const config = { configurable: { thread_id: `spec08-pin-${Date.now()}` } }

        await graph.invoke(START_STATE, config)
        await graph.updateState(config, { decision: { action: 'pin', tables: ['t_042'] } })
        await graph.invoke(null, config)

        const snapshot = await graph.getState(config)
        expect(calls.retrieveMustInclude).toEqual([[], ['t_042']])
        expect(snapshot.values.schemaContext?.tableNames).toContain('t_042')
        expect(snapshot.next).toEqual(['human_review'])
      } finally {
        await checkpointer.end()
      }
    },
    30_000,
  )
})
