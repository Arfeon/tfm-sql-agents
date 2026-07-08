/**
 * Tests del cargador de prompts de agentes (`agents/*.md`): sustitución de
 * placeholders, carga real desde el repo y error claro si falta el fichero.
 */
import { describe, it, expect } from 'vitest'
import { loadAgentPrompt, fillPlaceholders } from '../../src/graphsql/infrastructure/config/agentPrompts'

describe('fillPlaceholders', () => {
  it('sustituye los placeholders con su valor', () => {
    expect(fillPlaceholders('Experto en {{dialect}}.', { dialect: 'PostgreSQL' })).toBe('Experto en PostgreSQL.')
  })

  it('deja tal cual un placeholder sin valor, para que se detecte', () => {
    expect(fillPlaceholders('Hola {{nombre}}', {})).toBe('Hola {{nombre}}')
  })
})

describe('loadAgentPrompt', () => {
  it('carga los prompts reales del repo con el dialecto sustituido', () => {
    expect(loadAgentPrompt('sql-generator', { dialect: 'PostgreSQL' })).toMatch(/experto en SQL para PostgreSQL/)
    expect(loadAgentPrompt('equivalence-judge', { dialect: 'PostgreSQL' })).toMatch(/REFERENCIA/)
    expect(loadAgentPrompt('judge', { dialect: 'PostgreSQL' })).toMatch(/revisor de consultas SQL/)
    expect(loadAgentPrompt('chat')).toMatch(/GraphSQL Agent/)
  })

  it('lanza un error claro si el fichero no existe', () => {
    expect(() => loadAgentPrompt('judge', {}, './carpeta-inexistente')).toThrow(/No encuentro el prompt/)
  })
})
