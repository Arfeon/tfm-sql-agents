/**
 * Puerto de la base de datos objetivo: una conexión de solo lectura sobre la que
 * lanzo consultas. Qué motor hay detrás lo decide el `TargetDatabaseFactory`.
 */
export interface ITargetDatabase {
  fetchAll<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** El adaptador limita de forma eficiente para su motor, sin traerse todo el resultado. */
  fetchCapped<T extends Record<string, unknown>>(
    sql: string,
    maxRows: number,
  ): Promise<{ rows: T[]; truncated: boolean }>
  /** Valida la consulta sin ejecutarla (p. ej. `EXPLAIN` en PostgreSQL); lanza si no es válida. */
  dryRun(sql: string): Promise<void>
  rowCount(table: string): Promise<number>
  close(): Promise<void>
}
