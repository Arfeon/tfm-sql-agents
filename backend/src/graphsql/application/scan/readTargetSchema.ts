/**
 * Lee el esquema de una BD objetivo con el adaptador adecuado y cierra la conexión.
 * Pieza común a la ingesta (→ Neo4j) y a la vectorización (→ pgvector).
 */
import { TargetDatabaseFactory } from '../../infrastructure/targetdb/TargetDatabaseFactory'
import { SchemaReaderFactory } from '../../infrastructure/targetdb/SchemaReaderFactory'
import type { TableSchema } from '../../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../infrastructure/config/targetDatabases'

export async function readTargetSchema(target: TargetDatabaseConfig): Promise<TableSchema[]> {
  const db = await TargetDatabaseFactory.connect(target)
  try {
    return await SchemaReaderFactory.create(target, db).readSchema()
  } finally {
    await db.close()
  }
}
