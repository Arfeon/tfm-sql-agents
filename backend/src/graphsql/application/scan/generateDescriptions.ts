/**
 * Caso de uso: generar descripciones de tabla con IA (SPEC de descripciones automáticas).
 * Por cada tabla de la BD objetivo mando al LLM su nombre + columnas + (opcional) una
 * muestra de filas, y recojo una frase de descripción. El resultado tiene el mismo formato
 * `[{ tableName, description }]` que ya consumen Neo4j y la vectorización.
 *
 * Recibe sus colaboradores inyectados (con un valor por defecto real) para poder probarlo
 * con dobles, sin Docker ni un LLM de verdad. Uso el modelo con rol `reasoning`: describir
 * una tabla es razonar sobre su propósito, no escribir SQL, y sale mejor con ese modelo.
 */
import type { ChatMessage } from '../../domain/ports/IChatModel'
import type { TableSchema } from '../../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../infrastructure/config/targetDatabases'
import { ChatModelFactory } from '../../infrastructure/llm/ChatModelFactory'
import { TargetDatabaseFactory } from '../../infrastructure/targetdb/TargetDatabaseFactory'
import { buildDescriptionPrompt, cleanDescription } from './describeTablesPrompt'
import { readTargetSchema } from './readTargetSchema'
import { sampleTableRows } from './sampleTableRows'

export interface GeneratedDescription {
  tableName: string
  description: string
}

export interface GenerateDescriptionsOptions {
  /** Si incluyo una muestra de filas en el prompt (el flujo lo gatea por proveedor). */
  includeSamples: boolean
  /** Cuántas filas por tabla como muestra. */
  sampleSize: number
  /** Contexto de negocio opcional para orientar al modelo (p. ej. "ERP de distribución"). */
  businessContext?: string
}

export interface GenerateDescriptionsDependencies {
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  /** Muestra por tabla, en una sola conexión; mapa vacío si no se piden muestras. */
  readSamples(
    target: TargetDatabaseConfig,
    tables: TableSchema[],
    sampleSize: number,
  ): Promise<Map<string, Record<string, unknown>[]>>
  chat(messages: ChatMessage[]): Promise<string>
  /** Progreso opcional para el CLI (tabla i de n). */
  onProgress?(done: number, total: number, tableName: string): void
}

export const defaultGenerateDescriptionsDependencies: GenerateDescriptionsDependencies = {
  readSchema: readTargetSchema,
  async readSamples(target, tables, sampleSize) {
    const samples = new Map<string, Record<string, unknown>[]>()
    const db = await TargetDatabaseFactory.connect(target)
    try {
      for (const table of tables) {
        // Una tabla que falle al muestrear (permisos, tabla enorme…) no aborta el resto:
        // simplemente se describe sin su muestra.
        try {
          samples.set(table.name, await sampleTableRows(db, table, target.type, sampleSize))
        } catch {
          samples.set(table.name, [])
        }
      }
    } finally {
      await db.close()
    }
    return samples
  },
  chat: (messages) => ChatModelFactory.fromEnv('reasoning').chat(messages),
}

export async function generateDescriptions(
  target: TargetDatabaseConfig,
  options: GenerateDescriptionsOptions,
  deps: GenerateDescriptionsDependencies = defaultGenerateDescriptionsDependencies,
): Promise<GeneratedDescription[]> {
  const tables = await deps.readSchema(target)
  const samples = options.includeSamples
    ? await deps.readSamples(target, tables, options.sampleSize)
    : new Map<string, Record<string, unknown>[]>()

  const results: GeneratedDescription[] = []
  for (const [index, table] of tables.entries()) {
    const sampleRows = options.includeSamples ? samples.get(table.name) : undefined
    // Cada tabla es una llamada independiente (system + esa tabla): no acumulo contexto
    // de las anteriores, así el prompt se mantiene pequeño y no se contaminan entre sí.
    const prompt = buildDescriptionPrompt(table, sampleRows, options.businessContext)
    // Una tabla que falle al llamar al modelo (timeout, contexto excedido…) no aborta el
    // resto ni tira lo ya generado: la dejo con descripción vacía y sigo. Mismo aislamiento
    // por tabla que `readSamples`; `saveDescriptions` ya descarta las vacías al escribir.
    let description = ''
    try {
      description = cleanDescription(await deps.chat(prompt))
    } catch {
      description = ''
    }
    results.push({ tableName: table.name, description })
    deps.onProgress?.(index + 1, tables.length, table.name)
  }
  return results
}
