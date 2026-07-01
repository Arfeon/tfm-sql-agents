/**
 * Tests unitarios del contexto de esquema (lógica pura del dominio).
 *
 * Compruebo el render del DDL (columnas, PK, FK) y que el contexto expone las
 * tablas, sus nombres y el DDL.
 */
import { describe, it, expect } from 'vitest'
import { renderSchemaDdl, buildSchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'

const CUSTOMER: TableSchema = {
  name: 'customer',
  schema: null,
  columns: [
    { name: 'customer_id', type: 'integer', nullable: false },
    { name: 'region_id', type: 'integer', nullable: false },
    { name: 'username', type: 'text', nullable: true },
  ],
  primaryKeys: ['customer_id'],
  foreignKeys: [{ column: 'region_id', referencesTable: 'region', referencesColumn: 'region_id' }],
}

describe('renderSchemaDdl', () => {
  it('renderiza CREATE TABLE con columnas, PK y FK', () => {
    const ddl = renderSchemaDdl([CUSTOMER])
    expect(ddl).toContain('CREATE TABLE customer (')
    expect(ddl).toContain('customer_id integer NOT NULL')
    expect(ddl).toContain('username text') // nullable: sin NOT NULL
    expect(ddl).not.toContain('username text NOT NULL')
    expect(ddl).toContain('PRIMARY KEY (customer_id)')
    expect(ddl).toContain('FOREIGN KEY (region_id) REFERENCES region(region_id)')
  })

  it('incluye la descripción como comentario cuando la hay', () => {
    const ddl = renderSchemaDdl([{ ...CUSTOMER, description: 'Clientes de la plataforma' }])
    expect(ddl).toContain('-- customer: Clientes de la plataforma')
  })

  it('marca la ausencia de descripción como comentario', () => {
    const ddl = renderSchemaDdl([{ ...CUSTOMER, name: 't_042', description: null }])
    expect(ddl).toContain('-- t_042: (sin descripción; propósito inferido del nombre y las columnas)')
  })

  it('cadena vacía cuando no hay tablas', () => {
    expect(renderSchemaDdl([])).toBe('')
  })
})

describe('buildSchemaContext', () => {
  it('expone tablas, nombres y DDL', () => {
    const context = buildSchemaContext([CUSTOMER])
    expect(context.tableNames).toEqual(['customer'])
    expect(context.tables).toHaveLength(1)
    expect(context.ddl).toContain('CREATE TABLE customer')
  })
})
