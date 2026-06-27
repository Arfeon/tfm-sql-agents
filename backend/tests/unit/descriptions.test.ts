/**
 * Tests unitarios de la detección y carga de descripciones de tablas.
 *
 * No tocan red: trabajo sobre una carpeta temporal donde escribo ficheros de
 * prueba, y compruebo que se ignora el `*.example.json`, que se combinan varios
 * ficheros y el comportamiento cuando la carpeta no existe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasDescriptionsFile, loadDescriptions } from '../../src/graphsql/infrastructure/config/descriptions'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graphsql-desc-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('hasDescriptionsFile', () => {
  it('falsoSiLaCarpetaNoExiste', () => {
    expect(hasDescriptionsFile(join(dir, 'no-existe'))).toBe(false)
  })

  it('falsoSiSoloEstaElFicheroDeEjemplo', () => {
    writeFileSync(join(dir, 'descriptions.example.json'), '[]')
    expect(hasDescriptionsFile(dir)).toBe(false)
  })

  it('verdaderoSiHayUnJsonReal', () => {
    writeFileSync(join(dir, 'descriptions.json'), '[]')
    expect(hasDescriptionsFile(dir)).toBe(true)
  })
})

describe('loadDescriptions', () => {
  it('combinaLosFicherosEIgnoraElDeEjemplo', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify([{ tableName: 'game', description: 'juegos' }]))
    writeFileSync(join(dir, 'b.json'), JSON.stringify([{ tableName: 'company', description: 'empresas' }]))
    writeFileSync(join(dir, 'descriptions.example.json'), JSON.stringify([{ tableName: 'game', description: 'NO DEBE USARSE' }]))

    const map = loadDescriptions(dir)
    expect(map.get('game')).toBe('juegos')
    expect(map.get('company')).toBe('empresas')
    expect(map.size).toBe(2)
  })

  it('mapaVacioSiLaCarpetaNoExiste', () => {
    expect(loadDescriptions(join(dir, 'no-existe')).size).toBe(0)
  })
})
