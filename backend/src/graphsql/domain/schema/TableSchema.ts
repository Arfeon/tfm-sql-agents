/**
 * Modelo del esquema de la base de datos objetivo.
 *
 * Es la representación, independiente del motor, de una tabla y sus relaciones.
 * Con esto trabajan tanto el lector de esquema como el volcado a Neo4j.
 */

export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
}

export interface ForeignKeySchema {
  column: string
  referencesTable: string
  referencesColumn: string
}

export interface TableSchema {
  name: string
  schema: string | null
  columns: ColumnSchema[]
  primaryKeys: string[]
  foreignKeys: ForeignKeySchema[]
}
