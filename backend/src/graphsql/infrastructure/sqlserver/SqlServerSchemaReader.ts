/**
 * Lector de esquema para SQL Server: `INFORMATION_SCHEMA` para tablas/columnas/PKs y
 * `sys.foreign_keys` para las FKs (`CONSTRAINT_COLUMN_USAGE` no da fiable la tabla referenciada).
 * Una consulta por aspecto sobre todo el esquema, agrupando en memoria.
 */
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { ISchemaReader } from '../../domain/ports/ISchemaReader'
import type { ColumnSchema, ForeignKeySchema, TableSchema } from '../../domain/schema/TableSchema'

export class SqlServerSchemaReader implements ISchemaReader {
  constructor(
    private readonly db: ITargetDatabase,
    private readonly schema: string = 'dbo',
  ) {}

  async readSchema(): Promise<TableSchema[]> {
    const tableNames = await this.fetchTableNames()
    const columnsByTable = await this.fetchColumns()
    const primaryKeysByTable = await this.fetchPrimaryKeys()
    const foreignKeysByTable = await this.fetchForeignKeys()

    return tableNames.map((name) => ({
      name,
      schema: this.schema === 'dbo' ? null : this.schema,
      columns: columnsByTable.get(name) ?? [],
      primaryKeys: primaryKeysByTable.get(name) ?? [],
      foreignKeys: foreignKeysByTable.get(name) ?? [],
    }))
  }

  private async fetchTableNames(): Promise<string[]> {
    const rows = await this.db.fetchAll<{ table_name: string }>(
      `SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = @p1 AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
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
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
              DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @p1
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
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
      `SELECT tc.TABLE_NAME AS table_name, kcu.COLUMN_NAME AS column_name
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p1`,
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
      `SELECT OBJECT_NAME(fk.parent_object_id) AS table_name,
              pc.name AS column_name,
              OBJECT_NAME(fk.referenced_object_id) AS references_table,
              rc.name AS references_column
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       JOIN sys.schemas s ON s.schema_id = fk.schema_id
       WHERE s.name = @p1`,
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
