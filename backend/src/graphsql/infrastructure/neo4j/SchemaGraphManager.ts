/**
 * Gestor del grafo de conocimiento del esquema en Neo4j. Modelo de datos:
 *   (:Table)-[:HAS_COLUMN]->(:Column)
 *   (:Table)-[:REFERENCES {from_column, to_column}]->(:Table)   // por cada FK
 */
import { z } from 'zod'
import { fullTableName, type TableSchema } from '../../domain/schema/TableSchema'
import type { Neo4jConnection } from './Neo4jConnection'

// Esquemas de las filas de cada consulta de lectura: como acaban en el contexto del
// generador de SQL, valido los alias del RETURN para no colar prompts corruptos.

const schemaSummaryRow = z.object({
  tables: z.number(),
  columns: z.number(),
  relationships: z.number(),
})

const tableNamesRow = z.object({
  names: z.array(z.string()),
})

/** Fila de `reconstructTables`: `schema`, `description` y `primary_keys` pueden faltar en el nodo (→ null). */
const tableRow = z.object({
  name: z.string(),
  schema: z.string().nullable(),
  description: z.string().nullable(),
  primaryKeys: z.array(z.string()).nullable(),
  columns: z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean() })),
  foreignKeys: z.array(z.object({ column: z.string(), referencesTable: z.string(), referencesColumn: z.string() })),
})

export type SchemaSummary = z.infer<typeof schemaSummaryRow>

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
    const rows = await this.neo4j.runValidated(schemaSummaryRow, `
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
    // Expando: las candidatas + sus vecinas por FK (un salto, ambos sentidos).
    const expanded = await this.neo4j.runValidated(
      tableNamesRow,
      `MATCH (t:Table) WHERE t.name IN $names
       OPTIONAL MATCH (t)-[:REFERENCES]-(neighbor:Table)
       WITH collect(t.name) + collect(neighbor.name) AS names
       UNWIND names AS name
       WITH DISTINCT name WHERE name IS NOT NULL
       RETURN collect(name) AS names`,
      { names: tableNames },
    )
    return this.reconstructTables(expanded[0]?.names ?? [])
  }

  /**
   * Tablas intermedias en el camino de FK más corto entre cada par de anclas (los "conectores"
   * del JOIN: hubs, tablas de unión), sin las anclas. Complementa las vecinas a un salto de
   * `getTablesWithForeignKeyNeighbors` con lo que la similitud no rescata.
   */
  async getConnectingTables(tableNames: string[], maxPathLength: number): Promise<TableSchema[]> {
    if (tableNames.length < 2) {
      return []
    }
    // Interpolo el rango (Neo4j no lo admite como parámetro); lo acoto a un entero pequeño.
    const maxLen = Math.min(Math.max(Math.trunc(maxPathLength), 1), 6)
    const rows = await this.neo4j.runValidated(
      tableNamesRow,
      `MATCH (a:Table), (b:Table)
       WHERE a.name IN $names AND b.name IN $names AND a.name < b.name
       MATCH path = shortestPath((a)-[:REFERENCES*1..${maxLen}]-(b))
       UNWIND nodes(path) AS node
       WITH collect(DISTINCT node.name) AS names
       RETURN names`,
      { names: tableNames },
    )
    const onPaths = rows[0]?.names ?? []
    const anchors = new Set(tableNames)
    const connectors = onPaths.filter((name) => !anchors.has(name))
    return this.reconstructTables(connectors)
  }

  /**
   * Devuelve exactamente las tablas indicadas (con sus columnas y claves), SIN
   * expandir por claves foráneas. Es la recuperación "solo vectorial" del ablation
   * (SPEC-11): las candidatas por significado, sin las vecinas que trae el grafo.
   */
  async getTables(tableNames: string[]): Promise<TableSchema[]> {
    return this.reconstructTables(tableNames)
  }

  /** Reconstruyo cada tabla con sus columnas y FKs (comprehensions: sin producto cartesiano). */
  private async reconstructTables(names: string[]): Promise<TableSchema[]> {
    if (names.length === 0) {
      return []
    }
    const rows = await this.neo4j.runValidated(
      tableRow,
      `MATCH (t:Table) WHERE t.name IN $names
       RETURN t.name AS name,
              t.schema AS schema,
              t.description AS description,
              t.primary_keys AS primaryKeys,
              [(t)-[:HAS_COLUMN]->(c:Column) | {name: c.name, type: c.type, nullable: c.nullable}] AS columns,
              [(t)-[fk:REFERENCES]->(ref:Table) | {column: fk.from_column, referencesTable: ref.name, referencesColumn: fk.to_column}] AS foreignKeys
       ORDER BY t.name`,
      { names },
    )

    return rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      description: row.description,
      columns: row.columns,
      primaryKeys: row.primaryKeys ?? [],
      foreignKeys: row.foreignKeys,
    }))
  }

  /** Actualiza SOLO la descripción de las tablas dadas (SPEC-29): un SET, sin tocar la estructura. */
  async updateTableDescriptions(changes: Map<string, string | null>): Promise<void> {
    if (changes.size === 0) {
      return
    }
    const rows = [...changes].map(([name, description]) => ({ name, description }))
    await this.neo4j.run(
      `UNWIND $rows AS row
       MATCH (t:Table {name: row.name})
       SET t.description = row.description`,
      { rows },
    )
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
