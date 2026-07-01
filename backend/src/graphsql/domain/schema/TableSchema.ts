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
  /**
   * Descripción de la tabla, si la hay (SPEC-03: sincronizada en Neo4j y pgvector).
   * La lleva el contexto para que el SQL Agent y el Judge sepan qué contiene una
   * tabla de nombre opaco; ausente cuando no está documentada.
   */
  description?: string | null
}

/** Nombre cualificado de la tabla (`esquema.tabla`), o solo el nombre si no tiene esquema. */
export function fullTableName(table: Pick<TableSchema, 'name' | 'schema'>): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name
}
