/**
 * Genera la SQL a partir de la pregunta y el DDL del contexto (SPEC-05). El dialecto
 * se inyecta en el prompt para que la sintaxis salga en el motor que toque.
 */
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import type { IChatModel } from '../domain/ports/IChatModel'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'

export interface SqlGenerationDependencies {
  createChatModel(): IChatModel
}

export const defaultSqlGenerationDependencies: SqlGenerationDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv(),
}

/**
 * La SQL anterior más lo que hay que ajustar, ya en texto: vale tanto para el reintento
 * automático (los problemas del Judge) como para el afinado del humano (su indicación).
 */
export interface Revision {
  previousSql: SqlStatement
  instructions: string
}

export function buildSqlSystemPrompt(dialect: string): string {
  return [
    `Eres un experto en SQL para ${dialect}. Generas una única consulta de SOLO LECTURA que responde a la pregunta, usando solo el esquema que se te da.`,
    'Reglas:',
    '- Usa exactamente los nombres de tablas y columnas del esquema; no inventes ni traduzcas identificadores.',
    `- Escribe la consulta en la sintaxis de ${dialect}.`,
    '- Solo lectura: la sentencia empieza por SELECT o WITH; nunca INSERT, UPDATE, DELETE ni DDL.',
    '- GROUP BY coherente con lo que agregas; añade el límite del dialecto (LIMIT/TOP) cuando la pregunta pida un "top N".',
    '- Si la pregunta no se puede responder con esas tablas, dilo en vez de inventar columnas.',
    'Devuelve solo la sentencia SQL, sin explicaciones ni vallas de código.',
  ].join('\n')
}

export function cleanSql(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:sql)?\s*([\s\S]*?)\s*```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

export async function generateSql(
  question: string,
  schemaContext: SchemaContext,
  dialect: string,
  revision?: Revision,
  deps: SqlGenerationDependencies = defaultSqlGenerationDependencies,
): Promise<SqlStatement> {
  const model = deps.createChatModel()
  const userMessageParts = [`Esquema disponible (DDL):\n\n${schemaContext.ddl}`, `Pregunta: ${question}`]
  if (revision) {
    userMessageParts.push(
      `Tu consulta anterior:\n${revision.previousSql.text}`,
      `Lo que hay que ajustar:\n${revision.instructions}`,
      'Reescribe la consulta teniéndolo en cuenta, sobre el esquema disponible.',
    )
  }
  const reply = await model.chat([
    { role: 'system', content: buildSqlSystemPrompt(dialect) },
    { role: 'user', content: userMessageParts.join('\n\n') },
  ])
  return { text: cleanSql(reply), dialect }
}
