/**
 * Resultado de ejecutar una consulta contra la BD objetivo (SPEC-07). Las filas
 * llegan ya recortadas al tope, para no inundar el terminal.
 */
export interface QueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  /** Las visibles, tras el recorte. */
  rowCount: number
  truncated: boolean
}
