/**
 * Caso de uso: generar la SQL a partir de la pregunta y el contexto de esquema (SPEC-05).
 *
 * Le paso al LLM (vía `IChatModel`) un mensaje de sistema con las reglas y el
 * dialecto del motor objetivo, y un mensaje de usuario con el DDL del contexto
 * (de SPEC-04) y la pregunta. Devuelvo la sentencia ya limpia (sin vallas de
 * código), con su dialecto. El dialecto se inyecta como variable, así la SQL sale
 * en la sintaxis del motor que toque (PostgreSQL, SQL Server…).
 *
 * Si vengo de una revisión (SPEC-10/15) recibo también la consulta anterior y una
 * instrucción de qué ajustar, y se las paso al LLM para que la corrija/amplíe en
 * vez de generar a ciegas otra vez. No sé de dónde sale esa instrucción (de los
 * errores del Judge en el reintento automático, o de la indicación del humano al
 * afinar): quien me llama me la da ya formateada como texto.
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

/**
 * Una revisión de la consulta anterior: la SQL que ya se generó más lo que hay que
 * ajustar (ya en texto). Sirve tanto para el reintento automático del supervisor
 * (SPEC-10, la instrucción son los problemas del Judge) como para el afinado del
 * humano (SPEC-15, la instrucción es su indicación en lenguaje natural).
 */
export interface Revision {
  previousSql: SqlStatement
  instructions: string
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
