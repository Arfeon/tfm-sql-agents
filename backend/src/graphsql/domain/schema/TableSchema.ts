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

/** Nombre cualificado de la tabla (`esquema.tabla`), o solo el nombre si no tiene esquema. */
export function fullTableName(table: Pick<TableSchema, 'name' | 'schema'>): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name
}
