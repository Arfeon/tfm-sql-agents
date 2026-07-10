/**
 * Fixtures de `TableSchema` para los tests de recuperación/selección: una tabla mínima
 * y una tabla con FK — lo único que varía entre casos es la FK, así que es lo único
 * que se declara en el test.
 */
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'

export function table(name: string): TableSchema {
  return {
    name,
    schema: null,
    columns: [{ name: `${name}_id`, type: 'integer', nullable: false }],
    primaryKeys: [`${name}_id`],
    foreignKeys: [],
  }
}

export function tableWithFk(name: string, column: string, referencesTable: string): TableSchema {
  return {
    ...table(name),
    columns: [
      { name: `${name}_id`, type: 'integer', nullable: false },
      { name: column, type: 'integer', nullable: false },
    ],
    foreignKeys: [{ column, referencesTable, referencesColumn: 'id' }],
  }
}
