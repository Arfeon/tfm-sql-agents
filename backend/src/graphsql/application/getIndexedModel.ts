/**
 * Lee el modelo/dimensión del índice vectorial actual (el CLI avisa de un cambio de
 * modelo antes de re-vectorizar). La dependencia es la operación completa, no el
 * almacén: `getIndexedModel` no forma parte del puerto `IEmbeddingsStore`.
 */
import { TableEmbeddingsStore, type IndexedModel } from '../infrastructure/postgres/TableEmbeddingsStore'

export interface GetIndexedModelDependencies {
  readIndexedModel(): Promise<IndexedModel | null>
}

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

/** `null` si no hay índice. */
export async function getIndexedModel(
  deps: GetIndexedModelDependencies = defaultGetIndexedModelDependencies,
): Promise<IndexedModel | null> {
  return deps.readIndexedModel()
}
