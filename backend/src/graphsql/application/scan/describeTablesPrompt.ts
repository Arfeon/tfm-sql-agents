/**
 * Construcción del prompt para describir una tabla (SPEC de descripciones automáticas).
 * Función pura: recibe el esquema de la tabla y, opcionalmente, una muestra de filas, y
 * devuelve los mensajes de chat. Separo esto del caso de uso para poder probar el prompt
 * sin LLM ni base de datos. La descripción se pide en ESPAÑOL, de una sola frase, igual
 * que las descripciones escritas a mano que ya consume la vectorización.
 */
import type { ChatMessage } from '../../domain/ports/IChatModel'
import type { TableSchema } from '../../domain/schema/TableSchema'

const SYSTEM_PROMPT = [
  'Eres un analista de datos que documenta el esquema de una base de datos.',
  'Te doy una tabla (su nombre, columnas y claves) y, a veces, una muestra de filas.',
  'Devuelve UNA sola frase en español que explique el PROPÓSITO DE NEGOCIO de la tabla:',
  'qué representa cada fila y para qué sirve. Sé concreto y evita rodeos.',
  'Reglas: responde solo con la frase, sin comillas, sin prefijos como "Descripción:",',
  'sin listar las columnas una a una y sin inventar relaciones que no estén en los datos.',
].join(' ')

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
): ChatMessage[] {
  const sections = [`Tabla: ${table.name}`, '', 'Columnas:', renderColumns(table)]

  if (sampleRows && sampleRows.length > 0) {
    sections.push('', `Muestra de ${sampleRows.length} fila(s):`, renderSampleRows(sampleRows))
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
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
