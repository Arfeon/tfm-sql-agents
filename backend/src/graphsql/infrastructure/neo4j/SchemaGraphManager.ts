/**
 * Gestor del grafo de conocimiento del esquema en Neo4j.
 *
 * Modelo de datos:
 *   (:Table)-[:HAS_COLUMN]->(:Column)
 *   (:Table)-[:REFERENCES {from_column, to_column}]->(:Table)   // por cada FK
 *
 * `importSchema` limpia el grafo de esquema y lo reconstruye desde cero a partir
 * del esquema leído de la BD objetivo.
 */
import { fullTableName, type TableSchema, type ColumnSchema, type ForeignKeySchema } from '../../domain/schema/TableSchema'
import type { Neo4jConnection } from './Neo4jConnection'

export interface SchemaSummary {
  tables: number
  columns: number
  relationships: number
}

export class SchemaGraphManager {
  constructor(private readonly neo4j: Neo4jConnection) {}

  async importSchema(tables: TableSchema[], descriptions?: Map<string, string>): Promise<void> {
    await this.clearSchemaGraph()
    await this.createConstraints()

    for (const table of tables) {
      await this.createTableNode(table, descriptions?.get(table.name) ?? null)
    }
    // Las relaciones van en una segunda pasada, cuando ya existen todas las tablas.
    for (const table of tables) {
      await this.createForeignKeyRelationships(table)
    }
  }

  async clearSchemaGraph(): Promise<void> {
    await this.neo4j.run('MATCH (n:Table) DETACH DELETE n')
    await this.neo4j.run('MATCH (n:Column) DETACH DELETE n')
  }

  async getSchemaSummary(): Promise<SchemaSummary> {
    const rows = await this.neo4j.run<SchemaSummary>(`
      MATCH (t:Table)
      OPTIONAL MATCH (t)-[:HAS_COLUMN]->(c:Column)
      OPTIONAL MATCH (t)-[r:REFERENCES]->(:Table)
      RETURN count(DISTINCT t) AS tables,
             count(DISTINCT c) AS columns,
             count(DISTINCT r) AS relationships
    `)
    return rows[0] ?? { tables: 0, columns: 0, relationships: 0 }
  }

  /**
   * Dadas unas tablas candidatas, devuelve esas tablas más sus vecinas por clave
   * foránea (relación `REFERENCES`, un salto en ambos sentidos), cada una con sus
   * columnas, claves primarias y foráneas. Es la expansión por grafo del GraphRAG.
   */
  async getTablesWithForeignKeyNeighbors(tableNames: string[]): Promise<TableSchema[]> {
    if (tableNames.length === 0) {
      return []
    }

    // 1. Expando: las candidatas + sus vecinas por FK (un salto, ambos sentidos).
    const expanded = await this.neo4j.run<{ names: string[] }>(
      `MATCH (t:Table) WHERE t.name IN $names
       OPTIONAL MATCH (t)-[:REFERENCES]-(neighbor:Table)
       WITH collect(t.name) + collect(neighbor.name) AS names
       UNWIND names AS name
       WITH DISTINCT name WHERE name IS NOT NULL
       RETURN collect(name) AS names`,
      { names: tableNames },
    )
    const allNames = expanded[0]?.names ?? []
    if (allNames.length === 0) {
      return []
    }

    // 2. Reconstruyo cada tabla con sus columnas y FKs (comprehensions: sin producto cartesiano).
    const rows = await this.neo4j.run<{
      name: string
      schema: string | null
      description: string | null
      primaryKeys: string[]
      columns: ColumnSchema[]
      foreignKeys: ForeignKeySchema[]
    }>(
      `MATCH (t:Table) WHERE t.name IN $names
       RETURN t.name AS name,
              t.schema AS schema,
              t.description AS description,
              t.primary_keys AS primaryKeys,
              [(t)-[:HAS_COLUMN]->(c:Column) | {name: c.name, type: c.type, nullable: c.nullable}] AS columns,
              [(t)-[fk:REFERENCES]->(ref:Table) | {column: fk.from_column, referencesTable: ref.name, referencesColumn: fk.to_column}] AS foreignKeys
       ORDER BY t.name`,
      { names: allNames },
    )

    return rows.map((row) => ({
      name: row.name,
      schema: row.schema ?? null,
      description: row.description ?? null,
      columns: row.columns,
      primaryKeys: row.primaryKeys ?? [],
      foreignKeys: row.foreignKeys,
    }))
  }

  private async createConstraints(): Promise<void> {
    await this.neo4j.run('CREATE CONSTRAINT table_name IF NOT EXISTS FOR (t:Table) REQUIRE t.name IS UNIQUE')
    await this.neo4j.run('CREATE INDEX table_search IF NOT EXISTS FOR (t:Table) ON (t.name)')
  }

  private async createTableNode(table: TableSchema, description: string | null): Promise<void> {
    const fullName = fullTableName(table)

    await this.neo4j.run(
      `CREATE (t:Table {
        name: $name,
        full_name: $fullName,
        schema: $schema,
        description: $description,
        primary_keys: $primaryKeys,
        column_count: $columnCount
      })`,
      {
        name: table.name,
        fullName,
        schema: table.schema,
        description,
        primaryKeys: table.primaryKeys,
        columnCount: table.columns.length,
      },
    )

    for (const column of table.columns) {
      await this.neo4j.run(
        `MATCH (t:Table {name: $tableName})
         CREATE (c:Column {
           name: $columnName,
           type: $columnType,
           nullable: $nullable,
           is_primary_key: $isPrimaryKey,
           table_name: $tableName
         })
         CREATE (t)-[:HAS_COLUMN]->(c)`,
        {
          tableName: table.name,
          columnName: column.name,
          columnType: column.type,
          nullable: column.nullable,
          isPrimaryKey: table.primaryKeys.includes(column.name),
        },
      )
    }
  }

  private async createForeignKeyRelationships(table: TableSchema): Promise<void> {
    for (const fk of table.foreignKeys) {
      await this.neo4j.run(
        `MATCH (from:Table {name: $fromTable})
         MATCH (to:Table {name: $toTable})
         WHERE from <> to
         CREATE (from)-[:REFERENCES { from_column: $fromColumn, to_column: $toColumn }]->(to)`,
        {
          fromTable: table.name,
          toTable: fk.referencesTable,
          fromColumn: fk.column,
          toColumn: fk.referencesColumn,
        },
      )
    }
  }
}
