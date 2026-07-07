/**
 * Puerto de embeddings. Expongo `model` y `dimensions` porque hay que guardarlos
 * junto a cada vector: la similitud solo tiene sentido dentro del mismo modelo y dimensión.
 */
export interface IEmbeddings {
  readonly model: string
  readonly dimensions: number

  embed(text: string): Promise<number[]>

  embedMany(texts: string[]): Promise<number[][]>
}
