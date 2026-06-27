/**
 * Tests unitarios del catálogo de bases de datos objetivo.
 *
 * No tocan red ni `.env`: paso un objeto de entorno explícito y compruebo la
 * lógica de parseo de claves numeradas, el fallback a la forma antigua y los
 * valores por defecto.
 */
import { describe, it, expect } from 'vitest'
import { loadTargetDatabases, targetDatabaseLabel } from '../../src/graphsql/infrastructure/config/targetDatabases'

describe('loadTargetDatabases', () => {
  it('clavesNumeradas_cargaTodasLasBdsEnOrden', () => {
    const env = {
      TARGET_DB_1_TYPE: 'postgresql',
      TARGET_DB_1_NAME: 'arcadia',
      TARGET_DB_1_HOST: 'host-1',
      TARGET_DB_1_PORT: '5433',
      TARGET_DB_2_TYPE: 'postgresql',
      TARGET_DB_2_NAME: 'segunda',
    }
    const targets = loadTargetDatabases(env)
    expect(targets).toHaveLength(2)
    expect(targets[0].name).toBe('arcadia')
    expect(targets[0].host).toBe('host-1')
    expect(targets[0].port).toBe(5433)
    expect(targets[1].name).toBe('segunda')
  })

  it('clavesNumeradas_paraEnElPrimerIndiceSinName', () => {
    // Declaro la 1 y la 3 (salto la 2): el catálogo debe quedarse solo con la 1.
    const env = { TARGET_DB_1_NAME: 'a', TARGET_DB_3_NAME: 'c' }
    expect(loadTargetDatabases(env).map((t) => t.name)).toEqual(['a'])
  })

  it('sinClavesNumeradas_caeALaFormaAntiguaSinIndice', () => {
    const env = { TARGET_DB_NAME: 'legacy', TARGET_DB_HOST: 'host-legacy' }
    const targets = loadTargetDatabases(env)
    expect(targets).toHaveLength(1)
    expect(targets[0].name).toBe('legacy')
    expect(targets[0].host).toBe('host-legacy')
  })

  it('aplicaValoresPorDefectoCuandoFaltanCampos', () => {
    const targets = loadTargetDatabases({ TARGET_DB_1_NAME: 'x' })
    expect(targets[0]).toMatchObject({
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      schema: 'public',
    })
  })

  it('entornoVacio_devuelveUnaBdConTodosLosDefaults', () => {
    const targets = loadTargetDatabases({})
    expect(targets).toHaveLength(1)
    expect(targets[0].name).toBe('arcadia')
  })
})

describe('targetDatabaseLabel', () => {
  it('formateaComoTipoBarraNombre', () => {
    const label = targetDatabaseLabel({
      type: 'postgresql',
      name: 'arcadia',
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      schema: 'public',
    })
    expect(label).toBe('postgresql / arcadia')
  })
})
