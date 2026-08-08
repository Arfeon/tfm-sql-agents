/**
 * Tests unitarios de la generación de descripciones con IA. No tocan red ni BD: doblo el
 * `chat` y el lector de esquema/muestra, y compruebo el prompt, el guardarraíl de privacidad
 * y que la muestra solo se pide (y solo entra en el prompt) cuando se autoriza.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDescriptionPrompt,
  renderColumns,
  cleanDescription,
} from '../../src/graphsql/application/scan/describeTablesPrompt'
import {
  quoteIdentifier,
  qualifiedTableName,
} from '../../src/graphsql/application/scan/sampleTableRows'
import {
  generateDescriptions,
  type GenerateDescriptionsDependencies,
} from '../../src/graphsql/application/scan/generateDescriptions'
import { requiresRemoteDataConsent } from '../../src/cli/flows/generateDescriptions'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'
import { saveDescriptions } from '../../src/graphsql/infrastructure/config/descriptions'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'

const CUSTOMER: TableSchema = {
  name: 'customer',
  schema: null,
  columns: [
    { name: 'customer_id', type: 'integer', nullable: false },
    { name: 'country_id', type: 'integer', nullable: false },
    { name: 'name', type: 'text', nullable: true },
  ],
  primaryKeys: ['customer_id'],
  foreignKeys: [{ column: 'country_id', referencesTable: 'country', referencesColumn: 'country_id' }],
}

const TARGET: TargetDatabaseConfig = {
  type: 'postgresql',
  name: 'meridian',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'x',
  schema: 'public',
}

describe('renderColumns', () => {
  it('marca la PK y la FR con su destino', () => {
    const lines = renderColumns(CUSTOMER)
    expect(lines).toContain('- customer_id: integer NOT NULL [PK]')
    expect(lines).toContain('- country_id: integer NOT NULL [FK→country.country_id]')
    expect(lines).toContain('- name: text')
  })
})

describe('buildDescriptionPrompt', () => {
  it('sin muestra: no añade la sección de filas', () => {
    const [, user] = buildDescriptionPrompt(CUSTOMER)
    expect(user.content).toContain('Tabla: customer')
    expect(user.content).not.toContain('Muestra')
  })

  it('con muestra: incluye las filas como JSON', () => {
    const [, user] = buildDescriptionPrompt(CUSTOMER, [{ customer_id: 1, name: 'ACME' }])
    expect(user.content).toContain('Muestra de 1 fila(s):')
    expect(user.content).toContain('"ACME"')
  })

  it('normaliza valores no serializables de la muestra (Buffer y bigint)', () => {
    const [, user] = buildDescriptionPrompt(CUSTOMER, [
      { id: 1, blob: Buffer.from('hello'), big: 9007199254740993n },
    ])
    expect(user.content).toContain('<binary 5 bytes>')
    expect(user.content).toContain('"9007199254740993"')
    expect(user.content).not.toContain('"type":"Buffer"')
  })

  it('inyecta el contexto de negocio en el system prompt cuando se da', () => {
    const [system] = buildDescriptionPrompt(CUSTOMER, undefined, 'ERP de distribución mayorista')
    expect(system.content).toContain('ERP de distribución mayorista')
  })

  it('sin contexto de negocio: no deja el placeholder suelto', () => {
    const [system] = buildDescriptionPrompt(CUSTOMER)
    expect(system.content).not.toContain('{{businessContext}}')
  })
})

describe('cleanDescription', () => {
  it('quita comillas y el prefijo "Descripción:"', () => {
    expect(cleanDescription('Descripción: "Clientes de la plataforma."')).toBe('Clientes de la plataforma.')
  })
  it('se queda con la primera línea no vacía', () => {
    expect(cleanDescription('\n\nClientes.\nOtra línea.')).toBe('Clientes.')
  })
})

describe('quoteIdentifier / qualifiedTableName', () => {
  it('cita con comillas dobles en PostgreSQL y corchetes en SQL Server', () => {
    expect(quoteIdentifier('order', 'postgresql')).toBe('"order"')
    expect(quoteIdentifier('order', 'mssql')).toBe('[order]')
  })
  it('cualifica con el schema cuando lo hay', () => {
    expect(qualifiedTableName({ name: 't', schema: 'dbo' }, 'mssql')).toBe('[dbo].[t]')
    expect(qualifiedTableName({ name: 't', schema: null }, 'postgresql')).toBe('"t"')
  })
})

describe('requiresRemoteDataConsent (guardarraíl de privacidad)', () => {
  it('exige consentimiento solo con muestra Y proveedor remoto (OpenAI)', () => {
    expect(requiresRemoteDataConsent(LlmProvider.OpenAI, true)).toBe(true)
    expect(requiresRemoteDataConsent(LlmProvider.OpenAI, false)).toBe(false)
    expect(requiresRemoteDataConsent(LlmProvider.Local, true)).toBe(false)
    expect(requiresRemoteDataConsent(LlmProvider.Local, false)).toBe(false)
  })
})

describe('generateDescriptions', () => {
  function fakeDeps(overrides: Partial<GenerateDescriptionsDependencies> = {}): {
    deps: GenerateDescriptionsDependencies
    prompts: string[]
    sampledSizes: number[]
  } {
    const prompts: string[] = []
    const sampledSizes: number[] = []
    const deps: GenerateDescriptionsDependencies = {
      readSchema: async () => [CUSTOMER],
      readSamples: async (_t, _tables, size) => {
        sampledSizes.push(size)
        return new Map([['customer', [{ customer_id: 1, name: 'ACME' }]]])
      },
      chat: async (messages) => {
        prompts.push(messages[1].content)
        return 'Clientes de la plataforma.'
      },
      ...overrides,
    }
    return { deps, prompts, sampledSizes }
  }

  it('con muestra: pide filas y las mete en el prompt', async () => {
    const { deps, prompts, sampledSizes } = fakeDeps()
    const result = await generateDescriptions(TARGET, { includeSamples: true, sampleSize: 10 }, deps)
    expect(result).toEqual([{ tableName: 'customer', description: 'Clientes de la plataforma.' }])
    expect(sampledSizes).toEqual([10])
    expect(prompts[0]).toContain('Muestra')
  })

  it('sin muestra: no pide filas ni las mete en el prompt', async () => {
    let sampled = false
    const { deps, prompts } = fakeDeps({
      readSamples: async () => {
        sampled = true
        return new Map()
      },
    })
    await generateDescriptions(TARGET, { includeSamples: false, sampleSize: 10 }, deps)
    expect(sampled).toBe(false)
    expect(prompts[0]).not.toContain('Muestra')
  })

  it('un fallo del modelo en una tabla no aborta el resto (descripción vacía y sigue)', async () => {
    const tables: TableSchema[] = [CUSTOMER, { ...CUSTOMER, name: 'invoice' }, { ...CUSTOMER, name: 'payment' }]
    const seen: string[] = []
    const deps: GenerateDescriptionsDependencies = {
      readSchema: async () => tables,
      readSamples: async () => new Map(),
      chat: async (messages) => {
        if (messages[1].content.includes('Tabla: invoice')) throw new Error('boom')
        return 'ok'
      },
      onProgress: (_done, _total, name) => seen.push(name),
    }
    const result = await generateDescriptions(TARGET, { includeSamples: false, sampleSize: 10 }, deps)
    expect(result).toEqual([
      { tableName: 'customer', description: 'ok' },
      { tableName: 'invoice', description: '' },
      { tableName: 'payment', description: 'ok' },
    ])
    expect(seen).toEqual(['customer', 'invoice', 'payment'])
  })

  it('reporta progreso por tabla', async () => {
    const seen: Array<[number, number, string]> = []
    const { deps } = fakeDeps({ onProgress: (done, total, name) => seen.push([done, total, name]) })
    await generateDescriptions(TARGET, { includeSamples: false, sampleSize: 10 }, deps)
    expect(seen).toEqual([[1, 1, 'customer']])
  })
})

describe('saveDescriptions', () => {
  it('escribe solo las que tienen texto, en formato [{tableName, description}]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'desc-'))
    try {
      const filePath = join(dir, 'meridian.json')
      const saved = saveDescriptions(
        [
          { tableName: 'customer', description: 'Clientes.' },
          { tableName: 'empty', description: '   ' },
        ],
        filePath,
      )
      expect(saved).toBe(1)
      const written = JSON.parse(readFileSync(filePath, 'utf8'))
      expect(written).toEqual([{ tableName: 'customer', description: 'Clientes.' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
