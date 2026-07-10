/**
 * Factory del lector de esquema: el único sitio que sabe qué lector usar por motor
 * (las consultas a `information_schema` difieren entre PostgreSQL, MySQL…).
 */
import { PostgresSchemaReader } from '../postgres/PostgresSchemaReader'
import { SqlServerSchemaReader } from '../sqlserver/SqlServerSchemaReader'
import type { TargetDatabaseConfig } from '../config/targetDatabases'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { ISchemaReader } from '../../domain/ports/ISchemaReader'

export const SchemaReaderFactory = {
  create(target: TargetDatabaseConfig, db: ITargetDatabase): ISchemaReader {
    switch (target.type) {
      case 'postgresql':
        return new PostgresSchemaReader(db, target.schema)
      case 'mssql':
        return new SqlServerSchemaReader(db, target.schema)
      default:
        throw new Error(`Lectura de esquema no soportada todavía para "${target.type}". De momento PostgreSQL y SQL Server.`)
    }
  },
}
