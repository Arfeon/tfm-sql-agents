/**
 * Tests de diagnóstico: compruebo que el servidor SQL Server responde.
 *
 * Ejecutar: npm test -- tests/diagnostic/sqlserver-connection.test.ts --reporter=verbose
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { TargetDatabaseFactory } from '../../src/graphsql/infrastructure/targetdb/TargetDatabaseFactory'
import { loadTargetDatabases } from '../../src/graphsql/infrastructure/config/targetDatabases'
import type { ITargetDatabase } from '../../src/graphsql/domain/ports/ITargetDatabase'

let db: ITargetDatabase

beforeAll(async () => {
  // Carga la configuración del entorno para SQL Server (TARGET_DB_1_...)
  const targets = loadTargetDatabases()
  const target = targets.find(t => t.type === 'mssql')
  
  if (!target) {
    throw new Error('No se encontró configuración de SQL Server en las variables de entorno.')
  }
  
  db = await TargetDatabaseFactory.connect(target)
})

afterAll(async () => {
  await db?.close()
})

describe('SQL Server target database', () => {
  it('se conecta y devuelve la versión', async () => {
    // Intenta ejecutar una consulta básica
    const rows = await db.fetchAll<{version: string}>('SELECT @@VERSION AS version')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].version).toBeDefined()
    console.log('Versión conectada:', rows[0].version)
  })

  it('obtiene las tablas de la BD actual', async () => {
    // Si la BD de SQL Server está vacía puede dar cero, pero al menos no falla la petición
    const rows = await db.fetchAll<{table_name: string}>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_type = 'BASE TABLE'
    `)
    expect(rows).toBeInstanceOf(Array)
    console.log(`Tablas encontradas: ${rows.length}`)
  })
})
