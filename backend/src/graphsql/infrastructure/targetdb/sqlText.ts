/**
 * Quito un único `;` final: los adaptadores incrustan la consulta en otra sentencia (cursor
 * en PostgreSQL, `describe_first_result_set` en SQL Server) y el `;` rompería la envolvente.
 */
export function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}
