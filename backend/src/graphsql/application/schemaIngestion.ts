/**
 * Caso de uso: ingerir el esquema de una BD objetivo en Neo4j.
 *
 * Orquesta dos pasos: leer el esquema de la BD objetivo y volcarlo al grafo.
 * Recibo esos dos pasos como dependencias (con implementación real por defecto),
 * así puedo probar la orquestación con dobles sin levantar Postgres ni Neo4j.
 * Lo usan tanto la tool del agente como el CLI.
 */
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager, type SchemaSummary } from '../infrastructure/neo4j/SchemaGraphManager'
import { readTargetSchema } from './readTargetSchema'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

/** Lo que necesita la ingesta del mundo exterior. */
export interface SchemaIngestionDependencies {
  /** Lee el esquema de la BD objetivo. */
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  /** Vuelca las tablas al grafo y devuelve el resumen (gestiona su propia conexión). */
  importToGraph(tables: TableSchema[], descriptions?: Map<string, string>): Promise<SchemaSummary>
}

/** Implementación real: Postgres para leer el esquema, Neo4j para el grafo. */
export const defaultSchemaIngestionDependencies: SchemaIngestionDependencies = {
  readSchema: readTargetSchema,
  async importToGraph(tables, descriptions) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      const manager = new SchemaGraphManager(neo4j)
      await manager.importSchema(tables, descriptions)
      return await manager.getSchemaSummary()
    } finally {
      await neo4j.close()
    }
  },
}

/**
 * Leo el esquema de la BD objetivo y lo vuelco a Neo4j. Devuelve el resumen.
 * Si se aportan descripciones, las guarda en el atributo `description` de cada
 * tabla (sincronizado con lo que se vectoriza en pgvector).
 */
export async function ingestSchema(
  target: TargetDatabaseConfig,
  descriptions?: Map<string, string>,
  deps: SchemaIngestionDependencies = defaultSchemaIngestionDependencies,
): Promise<SchemaSummary> {
  const tables = await deps.readSchema(target)
  return deps.importToGraph(tables, descriptions)
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
