/**
 * Muestra de filas de una tabla objetivo, para que la IA infiera de qué va cada tabla
 * al generar su descripción (SPEC de descripciones automáticas). Es un `SELECT *` capado
 * por motor (vía `fetchCapped`, que solo trae `limit` filas), sobre la conexión de SOLO
 * lectura. La muestra es dato REAL: quien la pide asume la política de privacidad (el
 * flujo del CLI lo gatea con un aviso explícito si el LLM es remoto).
 */
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { TargetDbType } from '../../infrastructure/config/targetDatabases'
import type { TableSchema } from '../../domain/schema/TableSchema'

/** Cita un identificador según el motor, para el FROM del muestreo (evita inyección por nombre). */
export function quoteIdentifier(name: string, type: TargetDbType): string {
  if (type === 'mssql') {
    return `[${name.replace(/]/g, ']]')}]`
  }
  return `"${name.replace(/"/g, '""')}"`
}

/** Nombre cualificado y citado (`"schema"."tabla"`), listo para el FROM. */
export function qualifiedTableName(table: Pick<TableSchema, 'name' | 'schema'>, type: TargetDbType): string {
  const parts = table.schema ? [table.schema, table.name] : [table.name]
  return parts.map((part) => quoteIdentifier(part, type)).join('.')
}

/** Trae hasta `limit` filas de la tabla (orden natural: no impongo ORDER BY, solo quiero una muestra). */
export async function sampleTableRows(
  db: ITargetDatabase,
  table: Pick<TableSchema, 'name' | 'schema'>,
  type: TargetDbType,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await db.fetchCapped<Record<string, unknown>>(
    `SELECT * FROM ${qualifiedTableName(table, type)}`,
    limit,
  )
  return rows
}
