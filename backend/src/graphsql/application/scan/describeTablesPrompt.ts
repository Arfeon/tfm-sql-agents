/**
 * Construcción del prompt para describir una tabla (SPEC de descripciones automáticas).
 * El system prompt vive en `agents/describe-tables.md` (como el resto de agentes), con un
 * hueco `{{businessContext}}` para dar al "analista" un contexto de negocio opcional. Lo
 * demás (columnas y muestra) se arma aquí, para poder probar el prompt sin LLM ni BD. La
 * descripción se pide en ESPAÑOL, de una sola frase, igual que las escritas a mano.
 */
import type { ChatMessage } from '../../domain/ports/IChatModel'
import type { TableSchema } from '../../domain/schema/TableSchema'
import { loadAgentPrompt } from '../../infrastructure/config/agentPrompts'

/** El contexto de negocio, si lo hay, como una línea para el system prompt; vacío si no. */
function renderBusinessContext(businessContext?: string): string {
  const trimmed = businessContext?.trim()
  return trimmed ? `Contexto de negocio de esta base de datos: ${trimmed}` : ''
}

/** Una línea por columna: nombre, tipo, y marca de PK / FK (lo que orienta a un modelo de razonamiento). */
export function renderColumns(table: TableSchema): string {
  const pk = new Set(table.primaryKeys)
  const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.column, fk]))
  return table.columns
    .map((column) => {
      const marks: string[] = []
      if (pk.has(column.name)) marks.push('PK')
      const fk = fkByColumn.get(column.name)
      if (fk) marks.push(`FK→${fk.referencesTable}.${fk.referencesColumn}`)
      const suffix = marks.length > 0 ? ` [${marks.join(', ')}]` : ''
      return `- ${column.name}: ${column.type}${column.nullable ? '' : ' NOT NULL'}${suffix}`
    })
    .join('\n')
}

/**
 * Muestra de filas como JSON compacto (una por línea). Trunco los textos largos para no
 * inflar el prompt ni volcar datos innecesarios. Si no hay filas, no añado la sección.
 */
export function renderSampleRows(rows: Record<string, unknown>[]): string {
  const MAX_TEXT = 80
  return rows
    .map((row) => {
      const trimmed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        trimmed[key] =
          typeof value === 'string' && value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
      }
      return JSON.stringify(trimmed)
    })
    .join('\n')
}

export function buildDescriptionPrompt(
  table: TableSchema,
  sampleRows?: Record<string, unknown>[],
  businessContext?: string,
): ChatMessage[] {
  const sections = [`Tabla: ${table.name}`, '', 'Columnas:', renderColumns(table)]

  if (sampleRows && sampleRows.length > 0) {
    sections.push('', `Muestra de ${sampleRows.length} fila(s):`, renderSampleRows(sampleRows))
  }

  return [
    { role: 'system', content: loadAgentPrompt('describe-tables', { businessContext: renderBusinessContext(businessContext) }) },
    { role: 'user', content: sections.join('\n') },
  ]
}

/** Limpia la respuesta del modelo: primera línea no vacía, sin comillas ni prefijo "Descripción:". */
export function cleanDescription(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return ''
  return firstLine
    .replace(/^(descripci[oó]n|description)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}
