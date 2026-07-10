/**
 * Selección de esquema con LLM: parseo tolerante de la respuesta y que solo sobreviven
 * nombres del pool (el selector no puede inventar tablas).
 */
import { describe, it, expect } from 'vitest'
import { parseSelectedTables, selectRelevantTables } from '../../src/graphsql/application/schemaSelection'
import type { SchemaSelectionDependencies } from '../../src/graphsql/application/schemaSelection'
import { table } from '../helpers/tableFixtures'

describe('parseSelectedTables', () => {
  const pool = new Set(['abonats', 'abo_linies', 'fib_linies'])

  it('lee una lista JSON y descarta lo que no está en el pool', () => {
    const chosen = parseSelectedTables('["abonats", "abo_linies", "tabla_inventada"]', pool)
    expect(chosen.sort()).toEqual(['abo_linies', 'abonats'])
  })

  it('si no hay JSON, trocea por tokens y filtra por el pool', () => {
    const chosen = parseSelectedTables('Yo usaría abonats y fib_linies.', pool)
    expect(chosen.sort()).toEqual(['abonats', 'fib_linies'])
  })
})

describe('selectRelevantTables', () => {
  it('pasa el pool al LLM y devuelve solo los nombres elegidos que existen', async () => {
    let sawCatalog = ''
    const deps: SchemaSelectionDependencies = {
      createChatModel: () => ({
        async chat(messages) {
          sawCatalog = messages[messages.length - 1].content
          return '["abonats", "abo_linies"]'
        },
      }),
    }

    const pool = [table('abonats'), table('abo_linies'), table('fib_linies')]
    const chosen = await selectRelevantTables('qué abonado tiene más líneas', pool, deps)

    expect(chosen.sort()).toEqual(['abo_linies', 'abonats'])
    // el catálogo que ve el LLM lleva las candidatas con sus columnas.
    expect(sawCatalog).toContain('abonats')
    expect(sawCatalog).toContain('columnas:')
  })

  it('con el pool vacío no llama al LLM', async () => {
    let called = false
    const deps: SchemaSelectionDependencies = {
      createChatModel: () => ({
        async chat() {
          called = true
          return '[]'
        },
      }),
    }
    expect(await selectRelevantTables('algo', [], deps)).toEqual([])
    expect(called).toBe(false)
  })
})
