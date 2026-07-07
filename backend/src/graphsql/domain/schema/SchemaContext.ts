/**
 * Contexto de esquema: el resultado de la recuperación (SPEC-04), con un DDL listo
 * para el prompt. `tableNames` va aparte porque es lo que mide el schema-linking recall.
 */
import type { TableSchema } from './TableSchema'

export interface SchemaContext {
  tables: TableSchema[]
  tableNames: string[]
  ddl: string
}

export function buildSchemaContext(tables: TableSchema[]): SchemaContext {
  return {
    tables,
    tableNames: tables.map((table) => table.name),
    ddl: renderSchemaDdl(tables),
  }
}

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
  // La descripción (o su ausencia) va como comentario para que el SQL Agent y el
  // Judge distingan lo documentado de lo supuesto (SPEC-14).
  const comment = table.description
    ? `-- ${table.name}: ${table.description}`
    : `-- ${table.name}: (sin descripción; propósito inferido del nombre y las columnas)`
  return `${comment}\nCREATE TABLE ${table.name} (\n${lines.join(',\n')}\n);`
}
