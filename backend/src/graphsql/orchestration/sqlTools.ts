/**
 * Tool de generación de SQL para el agente conversacional: recupera tablas, genera
 * la SQL y adjunta el veredicto del Judge. La salida es markdown plano a propósito:
 * pasa por el LLM del chat, que no admite ANSI.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { retrieveSchemaContext } from '../application/retrieval/schemaRetrieval'
import { generateSql } from '../application/sql/sqlGeneration'
import { judgeSql } from '../application/sql/sqlJudging'
import type { JudgeVerdict } from '../domain/sql/JudgeVerdict'
import { loadTargetDatabases, sqlDialectFor } from '../infrastructure/config/targetDatabases'
import { NO_RELEVANT_TABLES_MESSAGE } from './schemaTools'

/** El veredicto como sección propia, atribuida al Judge: que no se confunda con la consulta. */
export function renderJudgeVerdict(verdict: JudgeVerdict): string {
  const confidence = verdict.confidence !== undefined ? ` · confianza ${Math.round(verdict.confidence * 100)}%` : ''
  const lines = ['## Evaluación del Judge', '', `${verdict.valid ? '✅ Válida' : '❌ No válida'}${confidence}`]
  if (verdict.explanation) {
    lines.push('', `**Por qué:** ${verdict.explanation}`)
  }
  // Propósito de las tablas cuyo significado el Judge conoce (documentado/evidente);
  // las "supuestas" ya salen como aviso en la sección de cautelas (SPEC-14).
  const knownPurposes = (verdict.tablePurposes ?? []).filter((purpose) => purpose.source !== 'assumed')
  if (knownPurposes.length > 0) {
    lines.push('', '**Propósito de las tablas usadas:**', ...knownPurposes.map((purpose) => `- ${purpose.table} → “${purpose.purpose}”`))
  }
  if (verdict.errors.length > 0) {
    lines.push('', '**Problemas (impiden ejecutarla):**', ...verdict.errors.map((error) => `- ${error}`))
  }
  if (verdict.warnings.length > 0) {
    lines.push('', '**Qué le resta confianza / cautelas:**', ...verdict.warnings.map((warning) => `- ${warning}`))
  }
  if (verdict.suggestions.length > 0) {
    lines.push('', '**Sugerencias (opcionales):**', ...verdict.suggestions.map((suggestion) => `- ${suggestion}`))
  }
  return lines.join('\n')
}

const generateSqlTool = tool(
  async ({ pregunta }) => {
    const context = await retrieveSchemaContext(pregunta)
    if (context.tableNames.length === 0) {
      return NO_RELEVANT_TABLES_MESSAGE
    }
    const dialect = sqlDialectFor(loadTargetDatabases()[0])
    const sql = await generateSql(pregunta, context, dialect)
    const verdict = await judgeSql(sql, context, pregunta, { useDbCheck: true, useLlmJudge: true })
    return [
      `## Consulta SQL (${sql.dialect})`,
      '',
      `Tablas usadas: ${context.tableNames.join(', ')}`,
      '',
      '```sql',
      sql.text,
      '```',
      '',
      renderJudgeVerdict(verdict),
    ].join('\n')
  },
  {
    name: 'generar_sql',
    description:
      'Dada una pregunta en lenguaje natural, recupera las tablas relevantes, genera la consulta SQL de solo lectura que la responde (en el dialecto de la base de datos objetivo) y la valida con el Judge, devolviendo la consulta junto al veredicto (validez, confianza, avisos y sugerencias). Úsala cuando el usuario pida la consulta SQL o cómo obtener ciertos datos. (La SQL todavía no se ejecuta.)',
    schema: z.object({ pregunta: z.string().describe('La pregunta en lenguaje natural') }),
  },
)

export const sqlTools = [generateSqlTool]
