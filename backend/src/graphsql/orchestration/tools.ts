/**
 * Tool de demostración del primer grafo (SPEC-01): una acción determinista para
 * comprobar que el agente sabe llamar a una herramienta y usar su resultado.
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
