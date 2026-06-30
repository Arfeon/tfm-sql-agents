/**
 * Factory del lector de esquema.
 *
 * Es el único sitio que sabe qué lector de esquema usar para cada motor (las
 * consultas a `information_schema` difieren entre PostgreSQL, MySQL…). Devuelve un
 * `ISchemaReader`, así los casos de uso no construyen un lector concreto. Mismo
 * patrón que `TargetDatabaseFactory`.
 */
import { PostgresSchemaReader } from '../postgres/PostgresSchemaReader'
import type { TargetDatabaseConfig } from '../config/targetDatabases'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { ISchemaReader } from '../../domain/ports/ISchemaReader'

export const SchemaReaderFactory = {
  /** Crea el lector de esquema adecuado para el motor de la BD objetivo. */
  create(target: TargetDatabaseConfig, db: ITargetDatabase): ISchemaReader {
    switch (target.type) {
      case 'postgresql':
        return new PostgresSchemaReader(db, target.schema)
      default:
        throw new Error(`Lectura de esquema no soportada todavía para "${target.type}". De momento solo PostgreSQL.`)
    }
  },
}
