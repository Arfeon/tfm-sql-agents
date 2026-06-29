/**
 * Puerto del almacén de vectores de tablas.
 *
 * Es lo que necesita la vectorización para guardar el esquema: reconstruir el
 * índice, meter cada tabla con su vector, contar y cerrar. Detrás está pgvector
 * (`TableEmbeddingsStore`), pero el caso de uso solo conoce esta interfaz, así
 * que en los tests le puedo pasar un doble en memoria. Igual que `ITargetDatabase`
 * o `IEmbeddings`.
 */
/** Una tabla candidata devuelta por la búsqueda semántica, con su similitud. */
export interface TableMatch {
  tableName: string
  score: number
}

export interface IEmbeddingsStore {
  /** Reconstruye la tabla de embeddings con la dimensión indicada. */
  prepare(dimensions: number): Promise<void>

  /** Guarda (o reemplaza) una tabla con su texto de búsqueda, su vector y el modelo usado. */
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

  /** Las `limit` tablas más parecidas a un vector de consulta (por similitud coseno, descendente). */
  searchSimilar(embedding: number[], limit: number): Promise<TableMatch[]>

  /** Número de tablas guardadas. */
  count(): Promise<number>

  /** Cierra la conexión. */
  close(): Promise<void>
}
