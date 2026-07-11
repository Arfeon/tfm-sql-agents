/**
 * Tests del helper puro del menú principal: qué opciones se ofrecen (y cuáles se
 * deshabilitan) según el estado del índice vectorial. El `select` de @inquirer no
 * se prueba; sí la regla de primera vez que guía hacia el escaneo.
 */
import { describe, it, expect } from 'vitest'
import { buildMainMenuChoices } from '../../src/cli/mainMenu'

function valuesOf(choices: ReturnType<typeof buildMainMenuChoices>): string[] {
  return choices.map((c) => c.value)
}

describe('buildMainMenuChoices', () => {
  it('sin índice (primera vez): escanear va primero y consultar/depurar quedan deshabilitadas con motivo', () => {
    const choices = buildMainMenuChoices(false)
    expect(valuesOf(choices)).toEqual(['scan', 'query', 'debug', 'exit'])
    const byValue = Object.fromEntries(choices.map((c) => [c.value, c]))
    expect(byValue.scan.disabled).toBeUndefined()
    expect(byValue.exit.disabled).toBeUndefined()
    expect(byValue.query.disabled).toContain('esquema escaneado')
    expect(byValue.debug.disabled).toContain('esquema escaneado')
    expect(byValue.scan.name).toContain('empieza por aquí')
  })

  it('con índice: el menú normal, consultar primero y nada deshabilitado', () => {
    const choices = buildMainMenuChoices(true)
    expect(valuesOf(choices)).toEqual(['query', 'scan', 'debug', 'exit'])
    expect(choices.every((c) => c.disabled === undefined)).toBe(true)
  })

  it('estado desconocido (pgvector inaccesible): no se bloquea nada', () => {
    const choices = buildMainMenuChoices(null)
    expect(valuesOf(choices)).toEqual(['query', 'scan', 'debug', 'exit'])
    expect(choices.every((c) => c.disabled === undefined)).toBe(true)
  })
})
