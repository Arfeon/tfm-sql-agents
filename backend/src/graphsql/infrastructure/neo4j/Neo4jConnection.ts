/**
 * Conexión a Neo4j: envuelve el driver oficial (ejecutar Cypher, ping, cerrar).
 * Uso `disableLosslessIntegers` para recibir los enteros como `number` de JS.
 */
import neo4j, { type Driver } from 'neo4j-driver'
import type { z } from 'zod'
import { loadEnv } from '../config/env'

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
    const vars = loadEnv(env)
    return new Neo4jConnection(vars.NEO4J_URI, vars.NEO4J_USER, vars.NEO4J_PASSWORD, vars.NEO4J_DATABASE)
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

  /**
   * Como `run`, pero valida cada fila con un esquema: si un alias del RETURN deja de
   * cuadrar, falla aquí con un error claro en vez de propagar `undefined` río abajo.
   */
  async runValidated<Row>(
    rowSchema: z.ZodType<Row>,
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Row[]> {
    const rows = await this.run(cypher, params)
    return rows.map((row) => rowSchema.parse(row))
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
