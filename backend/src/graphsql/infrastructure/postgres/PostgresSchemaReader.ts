/**
 * Lector de esquema para PostgreSQL.
 *
 * Consulta `information_schema` para reconstruir el esquema (tablas, columnas,
 * claves primarias y foráneas) usando la conexión de solo lectura
 * `ITargetDatabase`. Hago una consulta por aspecto sobre todo el esquema y
 * agrupo en memoria, en vez de una consulta por tabla.
 */
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { ISchemaReader } from '../../domain/ports/ISchemaReader'
import type { ColumnSchema, ForeignKeySchema, TableSchema } from '../../domain/schema/TableSchema'

export class PostgresSchemaReader implements ISchemaReader {
  constructor(
    private readonly db: ITargetDatabase,
    private readonly schema: string = 'public',
  ) {}

  async readSchema(): Promise<TableSchema[]> {
    const tableNames = await this.fetchTableNames()
    const columnsByTable = await this.fetchColumns()
    const primaryKeysByTable = await this.fetchPrimaryKeys()
    const foreignKeysByTable = await this.fetchForeignKeys()

    return tableNames.map((name) => ({
      name,
      schema: this.schema === 'public' ? null : this.schema,
      columns: columnsByTable.get(name) ?? [],
      primaryKeys: primaryKeysByTable.get(name) ?? [],
      foreignKeys: foreignKeysByTable.get(name) ?? [],
    }))
  }

  private async fetchTableNames(): Promise<string[]> {
    const rows = await this.db.fetchAll<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [this.schema],
    )
    return rows.map((r) => r.table_name)
  }

  private async fetchColumns(): Promise<Map<string, ColumnSchema[]>> {
    const rows = await this.db.fetchAll<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [this.schema],
    )

    const byTable = new Map<string, ColumnSchema[]>()
    for (const row of rows) {
      const column: ColumnSchema = {
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
      }
      const columns = byTable.get(row.table_name) ?? []
      columns.push(column)
      byTable.set(row.table_name, columns)
    }
    return byTable
  }

  private async fetchPrimaryKeys(): Promise<Map<string, string[]>> {
    const rows = await this.db.fetchAll<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`,
      [this.schema],
    )

    const byTable = new Map<string, string[]>()
    for (const row of rows) {
      const keys = byTable.get(row.table_name) ?? []
      keys.push(row.column_name)
      byTable.set(row.table_name, keys)
    }
    return byTable
  }

  private async fetchForeignKeys(): Promise<Map<string, ForeignKeySchema[]>> {
    const rows = await this.db.fetchAll<{
      table_name: string
      column_name: string
      references_table: string
      references_column: string
    }>(
      `SELECT tc.table_name,
              kcu.column_name,
              ccu.table_name AS references_table,
              ccu.column_name AS references_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [this.schema],
    )

    const byTable = new Map<string, ForeignKeySchema[]>()
    for (const row of rows) {
      const foreignKeys = byTable.get(row.table_name) ?? []
      foreignKeys.push({
        column: row.column_name,
        referencesTable: row.references_table,
        referencesColumn: row.references_column,
      })
      byTable.set(row.table_name, foreignKeys)
    }
    return byTable
  }
}
