/**
 * Factory del checkpointer del grafo: persiste el estado en `graphsql_memory`, de
 * modo que la pausa de la revisión humana sobrevive al proceso (recuperable por thread_id).
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

function memoryConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.POSTGRES_HOST ?? 'localhost'
  const port = env.POSTGRES_PORT ?? '5432'
  const database = env.POSTGRES_DB ?? 'graphsql_memory'
  const user = env.POSTGRES_USER ?? 'postgres'
  const password = env.POSTGRES_PASSWORD ?? 'postgres'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

export class CheckpointerFactory {
  /** Crea sus tablas si no existen; al terminar hay que cerrarlo con `end()`. */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PostgresSaver> {
    const checkpointer = PostgresSaver.fromConnString(memoryConnectionString(env))
    await checkpointer.setup()
    return checkpointer
  }
}
