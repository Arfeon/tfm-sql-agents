/**
 * Factory del checkpointer del grafo (SPEC-08).
 *
 * El checkpointer es lo que persiste el estado del grafo entre pasos y, sobre
 * todo, mientras el pipeline está pausado esperando la revisión humana
 * (`interrupt_before`): el estado queda guardado y es recuperable por `thread_id`.
 *
 * Hasta SPEC-01 usaba un `MemorySaver` (en memoria, se pierde al cerrar). Aquí lo
 * muevo a PostgreSQL: guardo los checkpoints en la base `graphsql_memory` (la misma
 * que aloja los embeddings), de modo que una pausa sobreviva al proceso.
 *
 * Sigo el patrón factory del proyecto: este es el único sitio que sabe qué
 * checkpointer concreto se construye; el grafo solo conoce la abstracción de
 * LangGraph (`BaseCheckpointSaver`).
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

/** Cadena de conexión a `graphsql_memory` a partir de las variables `POSTGRES_*`. */
function memoryConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.POSTGRES_HOST ?? 'localhost'
  const port = env.POSTGRES_PORT ?? '5432'
  const database = env.POSTGRES_DB ?? 'graphsql_memory'
  const user = env.POSTGRES_USER ?? 'postgres'
  const password = env.POSTGRES_PASSWORD ?? 'postgres'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

export class CheckpointerFactory {
  /**
   * Construyo el checkpointer PostgreSQL y creo sus tablas si no existen
   * (`setup()`). Devuelvo un `PostgresSaver` listo para pasárselo al grafo al
   * compilarlo. Al terminar hay que cerrarlo con `checkpointer.end()`.
   */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PostgresSaver> {
    const checkpointer = PostgresSaver.fromConnString(memoryConnectionString(env))
    await checkpointer.setup()
    return checkpointer
  }
}
