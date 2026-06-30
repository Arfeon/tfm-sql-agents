/**
 * Tests unitarios del SQL Agent (SPEC-05).
 *
 * No tocan red: doblo el `IChatModel` y compruebo que el prompt lleva el DDL, la
 * pregunta y el dialecto, que la salida viene limpia (sin vallas) y que devuelve
 * la sentencia con su dialecto. La generación real se prueba en integración.
 */
import { describe, it, expect } from 'vitest'
import { generateSql, cleanSql } from '../../src/graphsql/application/sqlGeneration'
import type { SqlGenerationDependencies } from '../../src/graphsql/application/sqlGeneration'
import type { IChatModel, ChatMessage } from '../../src/graphsql/domain/ports/IChatModel'
import type { SchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'

const CONTEXT: SchemaContext = {
  tables: [],
  tableNames: ['customer', 'region'],
  ddl: 'CREATE TABLE customer (\n  customer_id integer NOT NULL,\n  region_id integer NOT NULL\n);',
}

describe('cleanSql', () => {
  it('quita las vallas ```sql', () => {
    expect(cleanSql('```sql\nSELECT 1\n```')).toBe('SELECT 1')
  })
  it('quita las vallas ``` sin lenguaje', () => {
    expect(cleanSql('```\nSELECT 1\n```')).toBe('SELECT 1')
  })
  it('deja la sentencia tal cual si no hay vallas', () => {
    expect(cleanSql('  SELECT 1  ')).toBe('SELECT 1')
  })
})

describe('generateSql', () => {
  it('pasa DDL, pregunta y dialecto al prompt, y devuelve la SQL limpia con su dialecto', async () => {
    let captured: ChatMessage[] = []
    const fakeModel: IChatModel = {
      chat: async (messages) => {
        captured = messages
        return '```sql\nSELECT region_id, COUNT(*) FROM customer GROUP BY region_id\n```'
      },
    }
    const deps: SqlGenerationDependencies = { createChatModel: () => fakeModel }

    const sql = await generateSql('¿cuántos clientes hay en cada región?', CONTEXT, 'PostgreSQL', deps)

    expect(sql.text).toBe('SELECT region_id, COUNT(*) FROM customer GROUP BY region_id')
    expect(sql.dialect).toBe('PostgreSQL')
    // el mensaje de sistema menciona el dialecto inyectado
    expect(captured[0].role).toBe('system')
    expect(captured[0].content).toContain('PostgreSQL')
    // el mensaje de usuario incluye el DDL del contexto y la pregunta
    expect(captured[1].content).toContain('CREATE TABLE customer')
    expect(captured[1].content).toContain('¿cuántos clientes hay en cada región?')
  })
})
