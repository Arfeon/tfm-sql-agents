/**
 * Puerto de embeddings.
 *
 * Convierte texto en un vector. El resto del sistema no sabe si por debajo hay
 * OpenAI o un modelo local. Expongo también `model` y `dimensions` porque hay
 * que guardarlos junto a cada vector: la similitud solo tiene sentido entre
 * vectores del mismo modelo y dimensión (ver docs/investigacion/embeddings.md).
 */
export interface IEmbeddings {
  readonly model: string
  readonly dimensions: number

  /** Embebe un texto (p. ej. una pregunta) y devuelve su vector. */
  embed(text: string): Promise<number[]>

  /** Embebe varios textos (p. ej. todas las tablas) en una sola llamada. */
  embedMany(texts: string[]): Promise<number[][]>
}
