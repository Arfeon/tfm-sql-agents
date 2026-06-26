/**
 * Conexión a Neo4j.
 *
 * Envuelve el driver oficial y ofrece lo justo: ejecutar Cypher, comprobar que
 * la instancia responde y cerrar. Uso `disableLosslessIntegers` para recibir los
 * enteros como `number` de JS (Neo4j devuelve enteros sin pérdida por defecto).
 */
import neo4j, { type Driver } from 'neo4j-driver'

export class Neo4jConnection {
  private readonly driver: Driver

  constructor(
    uri: string,
    user: string,
    password: string,
    private readonly database: string,
  ) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      disableLosslessIntegers: true,
    })
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Neo4jConnection {
    return new Neo4jConnection(
      env.NEO4J_URI ?? 'neo4j://localhost:7687',
      env.NEO4J_USER ?? 'neo4j',
      env.NEO4J_PASSWORD ?? 'neo4j',
      env.NEO4J_DATABASE ?? 'neo4j',
    )
  }

  async run<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const session = this.driver.session({ database: this.database })
    try {
      const result = await session.run(cypher, params)
      return result.records.map((record) => record.toObject() as T)
    } finally {
      await session.close()
    }
  }

  /** Comprueba que la instancia responde. */
  async isUp(): Promise<boolean> {
    try {
      await this.run('RETURN 1')
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }
}
