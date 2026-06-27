/**
 * Tests unitarios del caso de uso de ingesta.
 *
 * No tocan Postgres ni Neo4j: inyecto dependencias falsas (un lector de esquema
 * y un volcado al grafo) y compruebo que la orquestación encadena bien los pasos
 * y deja pasar las descripciones.
 */
import { describe, it, expect } from 'vitest'
import { ingestSchema } from '../../src/graphsql/application/schemaIngestion'
import type { SchemaIngestionDependencies } from '../../src/graphsql/application/schemaIngestion'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'

const TARGET: TargetDatabaseConfig = {
  type: 'postgresql',
  name: 'arcadia',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  schema: 'public',
}

const TABLES: TableSchema[] = [{ name: 'game', schema: null, columns: [], primaryKeys: [], foreignKeys: [] }]

describe('ingestSchema', () => {
  it('leeElEsquemaYLoVuelcaAlGrafo_devolviendoElResumen', async () => {
    let importedTables: TableSchema[] | undefined
    const deps: SchemaIngestionDependencies = {
      readSchema: async () => TABLES,
      importToGraph: async (tables) => {
        importedTables = tables
        return { tables: tables.length, columns: 5, relationships: 2 }
      },
    }

    const summary = await ingestSchema(TARGET, undefined, deps)

    expect(importedTables).toBe(TABLES)
    expect(summary).toEqual({ tables: 1, columns: 5, relationships: 2 })
  })

  it('pasaLasDescripcionesAlVolcadoDelGrafo', async () => {
    const descriptions = new Map([['game', 'catálogo de juegos']])
    let received: Map<string, string> | undefined
    const deps: SchemaIngestionDependencies = {
      readSchema: async () => TABLES,
      importToGraph: async (_tables, d) => {
        received = d
        return { tables: 0, columns: 0, relationships: 0 }
      },
    }

    await ingestSchema(TARGET, descriptions, deps)

    expect(received).toBe(descriptions)
  })
})
