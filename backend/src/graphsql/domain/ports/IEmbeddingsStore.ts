/**
 * Puerto del almacén de vectores de tablas (detrás está pgvector).
 */
/** Tabla candidata de la búsqueda semántica, con su similitud. */
export interface TableMatch {
  tableName: string
  score: number
}

export interface IEmbeddingsStore {
  /** Reconstruye la tabla entera: el almacén es de un solo inquilino (SPEC-18). */
  prepare(dimensions: number, targetName: string): Promise<void>

  upsertTable(
    tableName: string,
    fullName: string,
    provider: string,
    description: string | null,
    searchText: string,
    embedding: number[],
    model: string,
    dimensions: number,
  ): Promise<void>

  /** Por similitud coseno, descendente. */
  searchSimilar(embedding: number[], limit: number): Promise<TableMatch[]>

  count(): Promise<number>

  close(): Promise<void>
}
