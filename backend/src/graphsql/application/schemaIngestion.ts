/** Ingiere el esquema de una BD objetivo en Neo4j. Lo usan la tool del agente y el CLI. */
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager, type SchemaSummary } from '../infrastructure/neo4j/SchemaGraphManager'
import { readTargetSchema } from './readTargetSchema'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

export interface SchemaIngestionDependencies {
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  /** Gestiona su propia conexión al grafo. */
  importToGraph(tables: TableSchema[], descriptions?: Map<string, string>): Promise<SchemaSummary>
}

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

/** Las descripciones, si llegan, van al atributo `description` de cada tabla (sincronizado con pgvector). */
export async function ingestSchema(
  target: TargetDatabaseConfig,
  descriptions?: Map<string, string>,
  deps: SchemaIngestionDependencies = defaultSchemaIngestionDependencies,
): Promise<SchemaSummary> {
  const tables = await deps.readSchema(target)
  return deps.importToGraph(tables, descriptions)
}

export async function getSchemaSummary(): Promise<SchemaSummary> {
  const neo4j = Neo4jConnection.fromEnv()
  try {
    return await new SchemaGraphManager(neo4j).getSchemaSummary()
  } finally {
    await neo4j.close()
  }
}
