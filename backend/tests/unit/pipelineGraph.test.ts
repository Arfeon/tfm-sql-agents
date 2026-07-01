/**
 * Tests unitarios del pipeline con revisión humana (SPEC-08).
 *
 * No tocan Postgres, Neo4j ni el LLM: uso un checkpointer en memoria (`MemorySaver`)
 * y doblo los colaboradores (recuperar, generar, juzgar, ejecutar). Así compruebo lo
 * que importa del grafo: que se PAUSA antes de la revisión y persiste el estado, y
 * que al reanudar enruta según la decisión (aprobar/rechazar/modificar/fijar).
 */
import { describe, it, expect } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { createSqlPipelineGraph, type PipelineDependencies } from '../../src/graphsql/graph/pipelineGraph'
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

/** Dobles que registran las llamadas, para comprobar el enrutado. */
function makeDeps(overrides: Partial<PipelineDependencies> = {}) {
  const calls = { retrieveMustInclude: [] as string[][], judgeSql: [] as string[], executed: [] as string[] }
  const deps: PipelineDependencies = {
    retrieve: async (_question, mustInclude) => {
      calls.retrieveMustInclude.push(mustInclude)
      // La recuperación real trae 'customer' y, además, cualquier tabla fijada existente.
      return contextFor(['customer', ...mustInclude])
    },
    generate: async () => ({ text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }),
    judge: async (sql) => {
      calls.judgeSql.push(sql.text)
      return validVerdict
    },
    execute: async (sql) => {
      calls.executed.push(sql.text)
      return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, truncated: false }
    },
    ...overrides,
  }
  return { deps, calls }
}

const START_STATE = { question: '¿cuántos clientes?', dialect: 'PostgreSQL' }

describe('pipeline de revisión humana', () => {
  it('se pausa antes de la revisión y persiste la SQL y el veredicto', async () => {
    const { deps } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'pausa' } }

    await graph.invoke(START_STATE, config)

    const snapshot = await graph.getState(config)
    expect(snapshot.next).toEqual(['human_review'])
    expect(snapshot.values.sql?.text).toBe('SELECT * FROM customer')
    expect(snapshot.values.verdict?.valid).toBe(true)
    expect(snapshot.values.result).toBeNull()
  })

  it('aprobar continúa a ejecutar', async () => {
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'aprobar' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'approve' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    expect(snapshot.next).toEqual([])
    expect(calls.executed).toEqual(['SELECT * FROM customer'])
    expect(snapshot.values.result?.rowCount).toBe(1)
  })

  it('rechazar termina sin ejecutar', async () => {
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'rechazar' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'reject' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    expect(snapshot.next).toEqual([])
    expect(calls.executed).toEqual([])
    expect(snapshot.values.result).toBeNull()
  })

  it('modificar devuelve la SQL editada al Judge y vuelve a pausar', async () => {
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'modificar' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'modify', sql: 'SELECT COUNT(*) FROM customer' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // El Judge se llamó dos veces; la segunda con la SQL editada.
    expect(calls.judgeSql).toEqual(['SELECT * FROM customer', 'SELECT COUNT(*) FROM customer'])
    expect(snapshot.values.sql?.text).toBe('SELECT COUNT(*) FROM customer')
    expect(snapshot.next).toEqual(['human_review'])
    expect(calls.executed).toEqual([])
  })

  it('fijar una tabla rehace la recuperación con esa tabla y aparece en el contexto', async () => {
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'fijar' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'pin', tables: ['t_042'] } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // La recuperación se rehízo, esta vez con la tabla fijada.
    expect(calls.retrieveMustInclude).toEqual([[], ['t_042']])
    expect(snapshot.values.schemaContext?.tableNames).toContain('t_042')
    expect(snapshot.values.mustInclude).toEqual(['t_042'])
    expect(snapshot.next).toEqual(['human_review'])
  })

  it('marca fracasada la consulta que no supera el Judge', async () => {
    const invalidVerdict: JudgeVerdict = {
      valid: false,
      confidence: 0,
      errors: ['La base de datos rechazó la consulta'],
      warnings: [],
      suggestions: [],
      tablesVerified: [],
      explanation: 'sintaxis inválida',
    }
    const { deps } = makeDeps({ judge: async () => invalidVerdict })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'fracasada' } }

    await graph.invoke(START_STATE, config)

    const snapshot = await graph.getState(config)
    // Igual se para en la revisión, pero marcada como fracasada (no ejecutable).
    expect(snapshot.next).toEqual(['human_review'])
    expect(snapshot.values.failed).toBe(true)
  })
})
