/**
 * Lee el esquema de una BD objetivo con el adaptador adecuado y cierra la conexión.
 *
 * Es la pieza común a la ingesta (→ Neo4j) y a la vectorización (→ pgvector):
 * ambas empiezan necesitando el esquema de la BD objetivo. Centralizo aquí el
 * `type guard` del motor y el ciclo de vida de la conexión para no repetirlo.
 */
import { PostgresTargetDatabase } from '../infrastructure/postgres/PostgresTargetDatabase'
import { PostgresSchemaReader } from '../infrastructure/postgres/PostgresSchemaReader'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

export async function readTargetSchema(target: TargetDatabaseConfig): Promise<TableSchema[]> {
  if (target.type !== 'postgresql') {
    throw new Error(`Tipo de BD objetivo no soportado todavía: "${target.type}". De momento solo PostgreSQL.`)
  }

  const db = await PostgresTargetDatabase.fromParams({
    host: target.host,
    port: target.port,
    database: target.name,
    user: target.user,
    password: target.password,
  })
  try {
    return await new PostgresSchemaReader(db, target.schema).readSchema()
  } finally {
    await db.close()
  }
}
