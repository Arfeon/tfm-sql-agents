/**
 * SQL Agent de punta a punta con el LLM real: recupera contexto y genera un
 * SELECT/WITH. Opt-in; requiere Docker y el esquema vectorizado.
 */
import { describe, it, expect } from 'vitest'
import { retrieveSchemaContext } from '../../src/graphsql/application/retrieval/schemaRetrieval'
import { generateSql } from '../../src/graphsql/application/sql/sqlGeneration'
import { loadTargetDatabases, sqlDialectFor } from '../../src/graphsql/infrastructure/config/targetDatabases'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'

const provider = (process.env.LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
const hasCredentials =
  provider === LlmProvider.OpenAI ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.LMSTUDIO_BASE_URL)

describe.skipIf(!hasCredentials)(`generateSql (integración, provider=${provider})`, () => {
  it(
    'genera un SELECT plausible para una pregunta del golden set',
    async () => {
      const question = '¿cuántos clientes hay en cada región?'
      const context = await retrieveSchemaContext(question)
      const dialect = sqlDialectFor(loadTargetDatabases()[0])
      const sql = await generateSql(question, context, dialect)

      console.log(`\n🧠 SQL (${sql.dialect}):\n${sql.text}\n`)

      expect(sql.dialect).toBe('PostgreSQL')
      expect(sql.text.trimStart().toUpperCase()).toMatch(/^(SELECT|WITH)/)
    },
    60_000,
  )
})
