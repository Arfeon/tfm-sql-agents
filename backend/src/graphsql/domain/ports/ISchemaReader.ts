/**
 * Puerto para leer el esquema de la base de datos objetivo; cada motor tiene su adaptador.
 */
import type { TableSchema } from '../schema/TableSchema'

export interface ISchemaReader {
  readSchema(): Promise<TableSchema[]>
}
