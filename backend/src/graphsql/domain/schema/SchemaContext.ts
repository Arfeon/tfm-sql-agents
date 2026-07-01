/**
 * Contexto de esquema: el resultado de la recuperación (SPEC-04).
 *
 * Son las tablas relevantes para una pregunta —las candidatas por significado más
 * sus vecinas por clave foránea— con sus columnas y claves, y un texto tipo DDL
 * listo para el prompt del SQL Agent. Expongo aparte solo los nombres elegidos,
 * porque es lo que mido en el schema-linking recall de la evaluación.
 */
import type { TableSchema } from './TableSchema'

export interface SchemaContext {
  tables: TableSchema[]
  tableNames: string[]
  ddl: string
}

/** Compongo el contexto a partir de las tablas relevantes ya recuperadas. */
export function buildSchemaContext(tables: TableSchema[]): SchemaContext {
  return {
    tables,
    tableNames: tables.map((table) => table.name),
    ddl: renderSchemaDdl(tables),
  }
}

/** Renderizo las tablas como un DDL legible (solo esas tablas, con columnas y FKs). */
export function renderSchemaDdl(tables: TableSchema[]): string {
  return tables.map(renderTableDdl).join('\n\n')
}

function renderTableDdl(table: TableSchema): string {
  const lines = table.columns.map(
    (column) => `  ${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'}`,
  )
  if (table.primaryKeys.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKeys.join(', ')})`)
  }
  for (const foreignKey of table.foreignKeys) {
    lines.push(
      `  FOREIGN KEY (${foreignKey.column}) REFERENCES ${foreignKey.referencesTable}(${foreignKey.referencesColumn})`,
    )
  }
  // Marco la descripción (o su ausencia) como comentario, para que el SQL Agent y el
  // Judge sepan qué contiene la tabla y distingan lo documentado de lo supuesto (SPEC-14).
  const comment = table.description
    ? `-- ${table.name}: ${table.description}`
    : `-- ${table.name}: (sin descripción; propósito inferido del nombre y las columnas)`
  return `${comment}\nCREATE TABLE ${table.name} (\n${lines.join(',\n')}\n);`
}
