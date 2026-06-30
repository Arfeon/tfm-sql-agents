/**
 * Puerto de la base de datos objetivo: una conexión de solo lectura sobre la que
 * lanzo consultas. Los casos de uso dependen solo de esta abstracción; qué motor
 * hay detrás (PostgreSQL, …) y cómo conectarse lo decide el `TargetDatabaseFactory`.
 */
export interface ITargetDatabase {
  fetchAll<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  rowCount(table: string): Promise<number>
  /** Cierra la conexión. */
  close(): Promise<void>
}
