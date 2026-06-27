/**
 * Caso de uso: ingerir el esquema de una BD objetivo en Neo4j.
 *
 * Orquesta las piezas (lector de esquema + grafo Neo4j) y se asegura de cerrar
 * las conexiones. Lo usan tanto la tool del agente como el CLI.
 */
import { PostgresTargetDatabase } from '../infrastructure/postgres/PostgresTargetDatabase'
import { PostgresSchemaReader } from '../infrastructure/postgres/PostgresSchemaReader'
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager, type SchemaSummary } from '../infrastructure/neo4j/SchemaGraphManager'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

/**
 * Lee el esquema de la BD objetivo y lo vuelca a Neo4j. Devuelve el resumen.
 * Si se aportan descripciones, las guarda en el atributo `description` de cada
 * tabla (sincronizado con lo que se vectoriza en pgvector).
 */
export async function ingestSchema(
  target: TargetDatabaseConfig,
  descriptions?: Map<string, string>,
): Promise<SchemaSummary> {
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

  let tables
  try {
    tables = await new PostgresSchemaReader(db, target.schema).readSchema()
  } finally {
    await db.close()
  }

  const neo4j = Neo4jConnection.fromEnv()
  try {
    const manager = new SchemaGraphManager(neo4j)
    await manager.importSchema(tables, descriptions)
    return await manager.getSchemaSummary()
  } finally {
    await neo4j.close()
  }
}

/** Devuelve el resumen del esquema ya ingerido en Neo4j. */
export async function getSchemaSummary(): Promise<SchemaSummary> {
  const neo4j = Neo4jConnection.fromEnv()
  try {
    return await new SchemaGraphManager(neo4j).getSchemaSummary()
  } finally {
    await neo4j.close()
  }
}
