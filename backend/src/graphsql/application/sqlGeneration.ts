/**
 * Caso de uso: generar la SQL a partir de la pregunta y el contexto de esquema (SPEC-05).
 *
 * Le paso al LLM (vía `IChatModel`) un mensaje de sistema con las reglas y el
 * dialecto del motor objetivo, y un mensaje de usuario con el DDL del contexto
 * (de SPEC-04) y la pregunta. Devuelvo la sentencia ya limpia (sin vallas de
 * código), con su dialecto. El dialecto se inyecta como variable, así la SQL sale
 * en la sintaxis del motor que toque (PostgreSQL, SQL Server…).
 *
 * Recibo el `IChatModel` inyectado (real por defecto), para probarlo con un doble.
 */
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import type { IChatModel } from '../domain/ports/IChatModel'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'

export interface SqlGenerationDependencies {
  createChatModel(): IChatModel
}

/** Implementación real: el modelo configurado en el entorno (`LLM_PROVIDER`). */
export const defaultSqlGenerationDependencies: SqlGenerationDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv(),
}

/** Mensaje de sistema con las reglas, parametrizado por el dialecto del motor. */
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

/** Quito las vallas de código (```sql … ```) y los espacios, me quedo con la sentencia. */
export function cleanSql(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:sql)?\s*([\s\S]*?)\s*```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

export async function generateSql(
  question: string,
  schemaContext: SchemaContext,
  dialect: string,
  deps: SqlGenerationDependencies = defaultSqlGenerationDependencies,
): Promise<SqlStatement> {
  const model = deps.createChatModel()
  const reply = await model.chat([
    { role: 'system', content: buildSqlSystemPrompt(dialect) },
    { role: 'user', content: `Esquema disponible (DDL):\n\n${schemaContext.ddl}\n\nPregunta: ${question}` },
  ])
  return { text: cleanSql(reply), dialect }
}
