/**
 * Caso de uso: juez de equivalencia semántica entre dos consultas SQL (SPEC-11, D-11).
 *
 * La execution accuracy compara el RESULTADO (mismo conjunto de filas). Es objetiva y
 * reproducible, pero castiga respuestas que son correctas y solo difieren en cosas que
 * no cambian la respuesta a la pregunta: empates en un top-N, orden de filas, una columna
 * descriptiva de más, una agregación equivalente escrita distinto. Y como el LLM no es
 * determinista, exigir un resultado casi idéntico infravalora los aciertos.
 *
 * Aquí pregunto a un SEGUNDO LLM si la consulta candidata responde a la MISMA pregunta que
 * la de referencia. Es una métrica COMPLEMENTARIA, no la titular: un LLM también se equivoca
 * juzgando equivalencia (la equivalencia de consultas es indecidible en general), así que la
 * reporto al lado de la execution accuracy, nunca en su lugar.
 *
 * Recibo el `IChatModel` inyectado (real por defecto) para probarlo con dobles sin red.
 */
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import type { IChatModel } from '../domain/ports/IChatModel'

/** Veredicto del juez de equivalencia: si responden a la misma pregunta y por qué. */
export interface EquivalenceVerdict {
  equivalent: boolean
  reason: string
}

export interface SqlEquivalenceDependencies {
  createChatModel(): IChatModel
}

/** Implementación real: el modelo del entorno (`LLM_PROVIDER`). */
export const defaultSqlEquivalenceDependencies: SqlEquivalenceDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv(),
}

/** Mensaje de sistema: qué es "equivalente" y qué diferencias hay que ignorar. */
export function buildEquivalenceSystemPrompt(dialect: string): string {
  return [
    `Eres un evaluador experto de consultas ${dialect}. Te doy una pregunta en lenguaje natural y DOS consultas SQL: una de REFERENCIA (correcta) y una CANDIDATA.`,
    'Tu tarea es decidir si la candidata responde a la MISMA pregunta que la de referencia, es decir, si le daría al usuario la misma información.',
    '',
    'IGNORA las diferencias que no cambian la respuesta:',
    '- el orden de las columnas o de las filas,',
    '- columnas descriptivas de más (p. ej. incluir el id junto al nombre, o el nombre junto al total),',
    '- desempates arbitrarios en un top-N cuando hay valores iguales en el límite,',
    '- alias, mayúsculas, formato numérico, y formas equivalentes de escribir la misma agregación o JOIN.',
    '',
    'NO son equivalentes si difieren en algo que cambia la respuesta:',
    '- filtran, agrupan o agregan de forma distinta (otra métrica, otro criterio),',
    '- responden a otra pregunta o a una parte distinta de la pregunta,',
    '- una omite un filtro o una condición evidente que la otra sí aplica.',
    '',
    'Responde EXCLUSIVAMENTE con un JSON con esta forma, sin texto alrededor:',
    '{"equivalent": true|false, "reason": "una frase con el motivo"}',
  ].join('\n')
}

/**
 * Interpreto la respuesta del juez como `EquivalenceVerdict`. Si no es un JSON con al
 * menos el booleano `equivalent`, doy el veredicto por NO equivalente (conservador: una
 * respuesta ilegible no debe inflar los aciertos), dejando constancia en `reason`.
 */
export function parseEquivalenceVerdict(raw: string): EquivalenceVerdict {
  const jsonText = raw.match(/\{[\s\S]*\}/)
  if (!jsonText) {
    return notInterpretable()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText[0])
  } catch {
    return notInterpretable()
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return notInterpretable()
  }
  const fields = parsed as Record<string, unknown>
  if (typeof fields.equivalent !== 'boolean') {
    return notInterpretable()
  }
  return {
    equivalent: fields.equivalent,
    reason: typeof fields.reason === 'string' ? fields.reason : '',
  }
}

function notInterpretable(): EquivalenceVerdict {
  return { equivalent: false, reason: 'No se pudo interpretar el veredicto de equivalencia del LLM.' }
}

/**
 * Pregunto al LLM si la candidata responde a la misma pregunta que la de referencia.
 * La ejecutabilidad de la candidata es una precondición del que llama (aquí solo comparo
 * la intención de las dos consultas), tal y como pide la métrica de SPEC-11.
 */
export async function judgeQueryEquivalence(
  question: string,
  referenceSql: string,
  candidateSql: string,
  dialect: string,
  deps: SqlEquivalenceDependencies = defaultSqlEquivalenceDependencies,
): Promise<EquivalenceVerdict> {
  const model = deps.createChatModel()
  const reply = await model.chat([
    { role: 'system', content: buildEquivalenceSystemPrompt(dialect) },
    {
      role: 'user',
      content: [
        `Pregunta: ${question}`,
        `Consulta de REFERENCIA:\n${referenceSql}`,
        `Consulta CANDIDATA:\n${candidateSql}`,
      ].join('\n\n'),
    },
  ])
  return parseEquivalenceVerdict(reply)
}
