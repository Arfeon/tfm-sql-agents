/**
 * Tests unitarios del modelo de esquema (lógica pura del dominio).
 */
import { describe, it, expect } from 'vitest'
import { fullTableName } from '../../src/graphsql/domain/schema/TableSchema'

describe('fullTableName', () => {
  it('anteponeElEsquemaCuandoExiste', () => {
    expect(fullTableName({ name: 'game', schema: 'catalog' })).toBe('catalog.game')
  })

  it('usaSoloElNombreCuandoNoHayEsquema', () => {
    expect(fullTableName({ name: 'game', schema: null })).toBe('game')
  })
})
