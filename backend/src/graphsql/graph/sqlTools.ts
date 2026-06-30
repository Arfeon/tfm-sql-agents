/**
 * Tool de generación de SQL para el agente (SPEC-05 + SPEC-06).
 *
 * Dada una pregunta, recupera las tablas relevantes (SPEC-04), genera la SQL en
 * el dialecto de la BD objetivo (SPEC-05) y la pasa por el Judge (SPEC-06) para
 * acompañarla de su veredicto (validez, confianza, avisos, sugerencias). Así el
 * usuario ve siempre la "opinión" del Judge junto a la consulta. Ejecutarla es
 * SPEC-07; el bucle determinista de reintento será el supervisor (SPEC-10).
 *
 * Devuelvo el resultado en markdown (texto plano) a propósito: esta salida pasa por
 * el agente conversacional, que no admite colores ni cajas ANSI. La presentación
 * con color y cajas (chalk/boxen) vive en el CLI integrado del pipeline (SPEC-08/11),
 * donde pinto yo directamente sin LLM de por medio.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { retrieveSchemaContext } from '../application/schemaRetrieval'
import { generateSql } from '../application/sqlGeneration'
import { judgeSql } from '../application/sqlJudging'
import type { JudgeVerdict } from '../domain/sql/JudgeVerdict'
import { loadTargetDatabases, sqlDialectFor } from '../infrastructure/config/targetDatabases'

/**
 * Formateo el veredicto del Judge como una sección propia, separada de la consulta
 * y claramente atribuida al Judge: el veredicto y la confianza, el porqué, qué le
 * resta confianza y las sugerencias. Así el usuario distingue la consulta de su
 * evaluación.
 */
export function renderJudgeVerdict(verdict: JudgeVerdict): string {
  const confidence = verdict.confidence !== undefined ? ` · confianza ${Math.round(verdict.confidence * 100)}%` : ''
  const lines = ['## Evaluación del Judge', '', `${verdict.valid ? '✅ Válida' : '❌ No válida'}${confidence}`]
  if (verdict.explanation) {
    lines.push('', `**Por qué:** ${verdict.explanation}`)
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
      return 'No encontré tablas relevantes. ¿Está vectorizado el esquema? (CLI → "Escanear el esquema").'
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
