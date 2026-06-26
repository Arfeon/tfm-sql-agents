/**
 * Puerto para leer el esquema de la base de datos objetivo.
 *
 * Los casos de uso piden el esquema a través de esta interfaz sin saber si por
 * debajo hay PostgreSQL u otro motor. Cada motor tendrá su propio adaptador.
 */
import type { TableSchema } from '../schema/TableSchema'

export interface ISchemaReader {
  /** Devuelve todas las tablas del esquema con sus columnas, claves primarias y foráneas. */
  readSchema(): Promise<TableSchema[]>
}
