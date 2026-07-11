/**
 * Tests unitarios del pipeline con revisión humana (SPEC-08), supervisor (SPEC-10)
 * y afinado guiado (SPEC-15).
 *
 * No tocan Postgres, Neo4j ni el LLM: uso un checkpointer en memoria (`MemorySaver`)
 * y doblo los colaboradores (recuperar, generar, juzgar, ejecutar). Así compruebo lo
 * que importa del grafo: que se PAUSA antes de la revisión y persiste el estado, que
 * al reanudar enruta según la decisión (aprobar/rechazar/modificar/afinar), que el
 * bucle automático Judge↔SQL reintenta, se agota y respeta la modificación manual, y
 * que el afinado guía la recuperación y la generación.
 */
import { describe, it, expect, vi } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { createSqlPipelineGraph, makePipelineDependencies, MAX_JUDGE_ATTEMPTS, type PipelineDependencies } from '../../src/graphsql/orchestration/pipelineGraph'
import { TargetDatabaseFactory } from '../../src/graphsql/infrastructure/targetdb/TargetDatabaseFactory'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'
import type { SchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'
import type { JudgeVerdict } from '../../src/graphsql/domain/sql/JudgeVerdict'
import type { Revision } from '../../src/graphsql/application/sql/sqlGeneration'

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
  const calls = {
    retrieveQueries: [] as string[],
    retrieveMustInclude: [] as string[][],
    judgeSql: [] as string[],
    judgeQuestions: [] as string[],
    executed: [] as string[],
  }
  const deps: PipelineDependencies = {
    retrieve: async (question, mustInclude) => {
      calls.retrieveQueries.push(question)
      calls.retrieveMustInclude.push(mustInclude)
      // La recuperación real trae 'customer' y, además, cualquier tabla fijada existente.
      return contextFor(['customer', ...mustInclude])
    },
    generate: async () => ({ text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }),
    judge: async (sql, _schemaContext, question) => {
      calls.judgeSql.push(sql.text)
      calls.judgeQuestions.push(question)
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

  it('afinar forzando una tabla rehace la recuperación con esa tabla y aparece en el contexto', async () => {
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-fijar' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'refine', tables: ['t_042'] } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // La recuperación se rehízo, esta vez con la tabla forzada.
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

describe('supervisor: bucle automático Judge↔SQL (SPEC-10)', () => {
  it('reintenta automáticamente si el Judge invalida, pasando la consulta anterior y los problemas del Judge al SQL Agent', async () => {
    const invalidVerdict: JudgeVerdict = {
      valid: false,
      confidence: 0.3,
      errors: [],
      warnings: ['la columna customer.region no existe'],
      suggestions: [],
      tablesVerified: [],
      explanation: 'confianza baja',
    }
    const revisions: Array<Revision | undefined> = []
    const { deps } = makeDeps({
      generate: async (_question, _schemaContext, _dialect, revision) => {
        revisions.push(revision)
        return revisions.length === 1
          ? { text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }
          : { text: 'SELECT customer_id FROM customer', dialect: 'PostgreSQL' }
      },
      judge: async () => (revisions.length === 1 ? invalidVerdict : validVerdict),
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'reintento-exito' } }

    await graph.invoke(START_STATE, config)

    const snapshot = await graph.getState(config)
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toBeUndefined()
    // El reintento lleva la SQL anterior y, como instrucción, los problemas del Judge en texto.
    expect(revisions[1]?.previousSql.text).toBe('SELECT * FROM customer')
    expect(revisions[1]?.instructions).toContain('la columna customer.region no existe')
    expect(snapshot.values.sql?.text).toBe('SELECT customer_id FROM customer')
    expect(snapshot.values.attempts).toBe(2)
    expect(snapshot.next).toEqual(['human_review'])
    expect(snapshot.values.failed).toBe(false)
  })

  it('agota los intentos si el Judge siempre invalida y llega a la revisión fracasada', async () => {
    const invalidVerdict: JudgeVerdict = {
      valid: false,
      confidence: 0.2,
      errors: [],
      warnings: ['siempre falla'],
      suggestions: [],
      tablesVerified: [],
      explanation: 'nunca convence',
    }
    let generateCallCount = 0
    const { deps } = makeDeps({
      generate: async () => {
        generateCallCount++
        return { text: `SELECT ${generateCallCount} FROM customer`, dialect: 'PostgreSQL' }
      },
      judge: async () => invalidVerdict,
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'agotado' } }

    await graph.invoke(START_STATE, config)

    const snapshot = await graph.getState(config)
    expect(generateCallCount).toBe(MAX_JUDGE_ATTEMPTS)
    expect(snapshot.values.attempts).toBe(MAX_JUDGE_ATTEMPTS)
    expect(snapshot.values.failed).toBe(true)
    expect(snapshot.next).toEqual(['human_review'])
  })

  it('una SQL modificada a mano no entra en el reintento automático aunque el Judge la invalide', async () => {
    const invalidVerdict: JudgeVerdict = {
      valid: false,
      confidence: 0.1,
      errors: ['la edición manual sigue sin ser válida'],
      warnings: [],
      suggestions: [],
      tablesVerified: [],
      explanation: 'inválida',
    }
    let generateCallCount = 0
    const { deps, calls } = makeDeps({
      generate: async () => {
        generateCallCount++
        return { text: 'SELECT * FROM customer', dialect: 'PostgreSQL' }
      },
      judge: async (sql) => {
        calls.judgeSql.push(sql.text)
        // Válida la primera vez (la automática); inválida la SQL editada a mano.
        return calls.judgeSql.length === 1 ? validVerdict : invalidVerdict
      },
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'modificar-invalida' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'modify', sql: 'SELECT COUNT(*) FROM customer' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // No hay una segunda llamada a generate: el reintento automático no se dispara sobre una edición manual.
    expect(generateCallCount).toBe(1)
    expect(snapshot.values.sql?.text).toBe('SELECT COUNT(*) FROM customer')
    expect(snapshot.values.failed).toBe(true)
    expect(snapshot.next).toEqual(['human_review'])
  })

  it('afinar reinicia el contador de intentos del bucle Judge↔SQL', async () => {
    const invalidVerdict: JudgeVerdict = {
      valid: false,
      confidence: 0.2,
      errors: [],
      warnings: ['primer intento no vale'],
      suggestions: [],
      tablesVerified: [],
      explanation: 'no vale',
    }
    let judgeCallCount = 0
    const { deps } = makeDeps({
      judge: async () => {
        judgeCallCount++
        // Inválida la primera vez (antes de afinar); válida en las siguientes.
        return judgeCallCount === 1 ? invalidVerdict : validVerdict
      },
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-reinicio' } }

    await graph.invoke(START_STATE, config)
    // Antes de afinar, ya hubo un reintento automático (el primer veredicto fue inválido).
    const beforeRefine = await graph.getState(config)
    expect(beforeRefine.values.attempts).toBe(2)

    await graph.updateState(config, { decision: { action: 'refine', tables: ['t_042'] } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // Tras afinar y relanzar, el contador arrancó de cero: un único intento (válido) en el nuevo ciclo.
    expect(snapshot.values.attempts).toBe(1)
    expect(snapshot.next).toEqual(['human_review'])
  })
})

describe('afinado guiado por el humano (SPEC-15)', () => {
  it('afinar solo con una indicación guía al SQL Agent con la indicación y la consulta anterior', async () => {
    const revisions: Array<Revision | undefined> = []
    let genCount = 0
    const { deps } = makeDeps({
      generate: async (_question, _schemaContext, _dialect, revision) => {
        revisions.push(revision)
        genCount++
        return { text: genCount === 1 ? 'SELECT * FROM customer' : 'SELECT * FROM customer JOIN wishlist', dialect: 'PostgreSQL' }
      },
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-guia' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'refine', guidance: 'añade la popularidad por wishlist' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // La primera generación no lleva revisión; la de después del afinado sí, con la indicación.
    expect(revisions[0]).toBeUndefined()
    expect(revisions[1]).toEqual({
      previousSql: { text: 'SELECT * FROM customer', dialect: 'PostgreSQL' },
      instructions: 'añade la popularidad por wishlist',
    })
    expect(snapshot.next).toEqual(['human_review'])
  })

  it('el Judge evalúa contra la pregunta más las indicaciones del afinado', async () => {
    // Regresión: el Judge solo veía la pregunta original, así que penalizaba justo
    // lo que el humano acababa de pedir al afinar (p. ej. un alias solicitado).
    const { deps, calls } = makeDeps()
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-judge' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'refine', guidance: 'si no hay descripción dame el nombre' } })
    await graph.invoke(null, config)

    // Antes de afinar, la pregunta tal cual; después, la pregunta más la indicación.
    expect(calls.judgeQuestions[0]).toBe('¿cuántos clientes?')
    expect(calls.judgeQuestions[1]).toContain('¿cuántos clientes?')
    expect(calls.judgeQuestions[1]).toContain('si no hay descripción dame el nombre')
  })

  it('una indicación puede traer una tabla nueva por la recuperación, sin forzarla', async () => {
    const queries: string[] = []
    const { deps } = makeDeps({
      retrieve: async (question, mustInclude) => {
        queries.push(question)
        const tables = ['customer', ...mustInclude]
        // La recuperación real encontraría wishlist por significado si la pregunta la menciona.
        if (question.includes('wishlist')) {
          tables.push('wishlist')
        }
        return contextFor(tables)
      },
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-tabla-nueva' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'refine', guidance: 'añade la popularidad por wishlist' } })
    await graph.invoke(null, config)

    const snapshot = await graph.getState(config)
    // La segunda recuperación usó la pregunta + la indicación, así que wishlist entró sin fijarla.
    expect(queries[1]).toContain('wishlist')
    expect(snapshot.values.schemaContext?.tableNames).toContain('wishlist')
    expect(snapshot.values.mustInclude).toEqual([])
  })

  it('el afinado iterativo parte de la consulta afinada anterior y acumula las indicaciones', async () => {
    const revisions: Array<Revision | undefined> = []
    const generated = ['SELECT 1 FROM customer', 'SELECT 2 FROM customer', 'SELECT 3 FROM customer']
    let genCount = 0
    const { deps } = makeDeps({
      generate: async (_question, _schemaContext, _dialect, revision) => {
        revisions.push(revision)
        return { text: generated[genCount++], dialect: 'PostgreSQL' }
      },
    })
    const graph = createSqlPipelineGraph(new MemorySaver(), deps)
    const config = { configurable: { thread_id: 'afinar-iterativo' } }

    await graph.invoke(START_STATE, config)
    await graph.updateState(config, { decision: { action: 'refine', guidance: 'añade wishlist' } })
    await graph.invoke(null, config)
    await graph.updateState(config, { decision: { action: 'refine', guidance: 'ordena por total' } })
    await graph.invoke(null, config)

    // Cada afinado parte de la consulta generada en el anterior.
    expect(revisions[0]).toBeUndefined()
    expect(revisions[1]?.previousSql.text).toBe('SELECT 1 FROM customer')
    expect(revisions[2]?.previousSql.text).toBe('SELECT 2 FROM customer')
    // Las indicaciones se acumulan.
    expect(revisions[2]?.instructions).toContain('añade wishlist')
    expect(revisions[2]?.instructions).toContain('ordena por total')
  })

  it('makePipelineDependencies ejecuta y valida sintaxis contra la BD dada, no la de por defecto', async () => {
    // Regresión (SPEC-18): con una BD elegida, el dry-run del Judge y la ejecución
    // deben conectar a ESA BD, nunca a connectDefault (la primera del catálogo).
    const nebula: TargetDatabaseConfig = {
      type: 'postgresql', name: 'nebula', host: 'h', port: 5432, user: 'u', password: 'p', schema: 'public',
    }
    const spy = vi.spyOn(TargetDatabaseFactory, 'connect').mockRejectedValue(new Error('conexión interceptada'))
    try {
      const deps = makePipelineDependencies(nebula)
      await expect(deps.execute({ text: 'SELECT 1', dialect: 'PostgreSQL' })).rejects.toThrow('conexión interceptada')
      await expect(deps.judge({ text: 'SELECT 1', dialect: 'PostgreSQL' }, contextFor(['customer']), '¿?')).rejects.toThrow(
        'conexión interceptada',
      )
      // Todas las conexiones fueron a la BD elegida.
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
      for (const call of spy.mock.calls) {
        expect(call[0]).toMatchObject({ name: 'nebula' })
      }
    } finally {
      spy.mockRestore()
    }
  })
})
