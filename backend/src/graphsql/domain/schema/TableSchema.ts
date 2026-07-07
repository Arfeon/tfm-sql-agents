/**
 * Modelo del esquema de la BD objetivo: una tabla y sus relaciones, independiente del motor.
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
  /** Para que el SQL Agent y el Judge sepan qué contiene una tabla de nombre opaco (SPEC-03). */
  description?: string | null
}

export function fullTableName(table: Pick<TableSchema, 'name' | 'schema'>): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name
}
