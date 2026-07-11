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
import { createSqlPipelineGraph, type PipelineDependencies } from '../../src/graphsql/orchestration/pipelineGraph'
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

function makeDeps(): PipelineDependencies {
  return {
    retrieve: async (_question, mustInclude) => contextFor(['customer', ...mustInclude]),
    generate: async () => ({ text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }),
    judge: async () => validVerdict,
    execute: async () => ({ columns: ['n'], rows: [{ n: 1 }], rowCount: 1, truncated: false }),
  }
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
        const graph = createSqlPipelineGraph(checkpointer, makeDeps())
        await graph.invoke(START_STATE, config)
      } finally {
        await checkpointer.end()
      }

      // Un grafo y un checkpointer NUEVOS, sobre la misma BD, recuperan la pausa.
      const checkpointer2 = await CheckpointerFactory.fromEnv()
      try {
        const graph2 = createSqlPipelineGraph(checkpointer2, makeDeps())
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
})
