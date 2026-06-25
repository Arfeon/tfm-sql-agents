/**
 * Tools de demostración para el primer grafo (SPEC-01).
 *
 * Solo necesito una acción sencilla y determinista para comprobar que el agente
 * es capaz de decidir llamar a una herramienta y usar su resultado. Los agentes
 * reales (escaneo de esquema, ejecución SQL…) llegan en specs posteriores.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const checkSystemStatus = tool(
  async () => 'GraphSQL operativo ✅ (modelo y orquestación funcionando).',
  {
    name: 'comprobar_estado_sistema',
    description:
      'Comprueba el estado del sistema GraphSQL. Úsala cuando el usuario pregunte si el sistema está operativo o funcionando.',
    schema: z.object({}),
  },
)

export const demoTools = [checkSystemStatus]
