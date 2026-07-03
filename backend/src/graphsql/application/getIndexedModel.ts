/**
 * Caso de uso: leer el modelo/dimensión del índice vectorial actual.
 *
 * El CLI lo necesita para avisar de un cambio de modelo antes de re-vectorizar,
 * pero no debe hablar con el adaptador de pgvector directamente. Este caso de uso
 * abre el almacén, lee el modelo indexado y cierra, devolviendo solo el dato.
 *
 * Recibo la lectura inyectada (real por defecto), para poder probar la orquestación
 * con dobles. `getIndexedModel` no forma parte del puerto `IEmbeddingsStore` (solo
 * lo necesita este caso de uso y `schemaRetrieval.ts`), así que la dependencia es la
 * operación completa, no el almacén.
 */
import { TableEmbeddingsStore, type IndexedModel } from '../infrastructure/postgres/TableEmbeddingsStore'

/** Lo que necesita este caso de uso del mundo exterior. */
export interface GetIndexedModelDependencies {
  readIndexedModel(): Promise<IndexedModel | null>
}

/** Implementación real: pgvector. */
export const defaultGetIndexedModelDependencies: GetIndexedModelDependencies = {
  async readIndexedModel() {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      return await store.getIndexedModel()
    } finally {
      await store.close()
    }
  },
}

/** El modelo/dimensión con que está vectorizado el esquema, o null si no hay índice. */
export async function getIndexedModel(
  deps: GetIndexedModelDependencies = defaultGetIndexedModelDependencies,
): Promise<IndexedModel | null> {
  return deps.readIndexedModel()
}
