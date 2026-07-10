# Auditoría de la evaluación — 2026-07-09

Mi experiencia usando el sistema no cuadraba con las tablas: en el uso real las respuestas
salen bien, pero `escala-tiradas.md` mostraba a GraphRAG con un 67% "justo" en Arcadia y una
lista de casos que "fallan siempre". Antes de aceptar esos números como techo del sistema,
abrí los casos uno a uno — la misma disciplina que destapó el bug del 40% — y ejecuté a mano
la SQL de referencia y la generada contra la base de datos real.

**El resultado cambia la lectura entera: de los 9 fallos permanentes (7 en Arcadia, 2 en
Nebula), ninguno era una SQL claramente incorrecta del sistema.** Eran bugs de mis propias
referencias, casos incalificables por diseño y artefactos del comparador. El único déficit
real del sistema que apareció es uno de recuperación (G-21, tabla a 2 saltos), y ya estaba
acotado.

## Qué encontré, caso a caso

### 1. Referencias con bug: agrupar por nombre cuando hay nombres duplicados

Arcadia tiene títulos de juego repetidos (`Broken Empire` ×4, `Savage Dominion Reborn` ×4…)
y franquicias homónimas (`Crimson Covenant` ×2); Nebula igual (`Hollow Legacy` ×3). Mis
referencias agrupaban por `g.title` o `f.name`, fusionando juegos/franquicias distintos en
una fila. Las candidatas que agrupaban por `game_id` — **lo correcto** — devolvían datos
distintos y quedaban penalizadas.

Ejemplo (G-06, "los 10 juegos con más minutos"): la referencia daba `Neon Realm = 303.514`
(dos juegos fusionados); la candidata, `292.621` y `10.893` por separado. La candidata era
la respuesta buena.

- Afectados y corregidos: **G-06, G-11, G-16, G-19** (Arcadia), **N-06** (Nebula), **C-06** (confusión).
- En G-19 el bug además alteraba el top-5: `Crimson Covenant` (3,86 real) desaparecía del
  ranking de la referencia porque la fusión de homónimas le hundía la media.

### 2. Rankings con empates y sin desempate declarado: incalificables por diseño

- **G-22** ("el juego con más DLCs"): hay **41 juegos empatados** al máximo. La referencia
  hacía `LIMIT 1` — elegía uno al azar entre 41. Cualquier respuesta correcta fallaba la
  comparación exacta. Corregido: la pregunta pide todos los empatados y la referencia los devuelve.
- **N-07** ("los 10 clientes con más logros"): el seed ligero deja a **más de 14 clientes
  empatados a 8 logros**. Un top-10 correcto era una lotería. Corregido: la pregunta declara
  el desempate alfabético.
- **N-13** (top-5 wishlist): cuatro clientes empatados a 5 deseos para dos plazas. Igual que N-07.

### 3. Precisión numérica: un falso negativo doble (G-12)

"Duración media de sesión por plataforma": la referencia redondea (`ROUND(x,1) = 124.0`) y la
candidata no (`124.0037…`). **Los resultados eran idénticos** — mismas 8 plataformas, mismo
orden — pero la métrica justa exigía igualdad exacta del número, y el juez LLM tampoco lo
rescató: especuló con que el `INNER JOIN` de la candidata excluiría plataformas sin sesiones…
que en estos datos **no existen** (todas tienen ≥9.833 sesiones). Doble fallo del arnés, cero
fallo del sistema.

Corregido en el comparador justo (`evaluationMetrics.ts`): dos números casan si coinciden al
redondear ambos a la precisión más gruesa de los dos. La métrica **estricta sigue exacta**
(la escala estricta ⊆ justa ⊆ equivalente se mantiene), con tests unitarios del cambio.

### 4. Preguntas ambiguas: dos lecturas defendibles, solo una premiada

- **G-21** "¿Qué género *acumula* el mayor pico de jugadores concurrentes?": mi referencia
  entendía "el máximo de un solo juego" (Puzzle, 10.975); la candidata sumaba los concurrentes
  del género por instante (Platformer, 29.436) — una lectura de "acumula" como mínimo igual de
  razonable. Pregunta reformulada para fijar la lectura.
- **G-20** "ingresos por DLC desglosados por región": la candidata leyó "por DLC" como desglose
  por cada DLC. Pregunta reformulada ("ingresos totales de las compras de DLC…").

### 5. Lo que sí es del sistema (y se queda como está)

- **G-21, recall 0,75**: la recuperación no trajo `genre` — está a 2 saltos de las candidatas
  semánticas y la expansión por FK es de 1 salto. Déficit real y acotado; la mejora (expansión
  a 2 saltos) queda para el roadmap.
- **G-17** (churn <30 días): la generación omite a veces el filtro `status = 'cancelled'`.
  Fallo real e intermitente del LLM generador; es exactamente lo que la métrica debe cazar.
- Los casos rescatados por el juez de equivalencia por columnas extra o formato (G-07, N-06,
  N-07 antiguos…) funcionaban **como está diseñado**: para eso existe la métrica de equivalencia.

## Qué cambia

1. **Golden sets corregidos** (`setup/datasets/*/golden_set.yaml`, `golden_confusion.yaml`):
   agrupación por id, desempates declarados, dos preguntas desambiguadas. Cada corrección
   lleva su nota con fecha.
2. **Comparador justo con tolerancia de redondeo** (+9 tests; 178 en verde).
3. **Los números se regeneran**: 5 tiradas nuevas de `evaluate:scale` y del ablation de
   descripciones con el arnés corregido. Las tiradas antiguas quedan en
   `docs/evaluacion/tiradas/pre-auditoria/` como evidencia del antes.

## Resultados tras la corrección (añadido 2026-07-10)

Las 5 tiradas nuevas con el arnés corregido, comparadas con las 5 anteriores (media de
execution accuracy justa / equivalencia):

| BD | Modo | Antes (arnés con sesgos) | Después (arnés corregido) |
|---|---|---|---|
| arcadia | Sin recuperación | 73% / 90% | 87% / 96% |
| arcadia | GraphRAG | 67% / 83% | **88% / 94%** |
| nebula | Sin recuperación | 68% / 95% | 100% / 100% |
| nebula | GraphRAG | 72% / 96% | **93% / 99%** |

Tres confirmaciones y una lección de honestidad:

- **La sensación de uso era la correcta**: el sistema respondía bien; el arnés medía mal.
  GraphRAG en Nebula pasa de un aparente 72% a un 93% justo (idéntico en las 5 tiradas) y
  99% de equivalencia.
- **Las correcciones eran de arnés, no de sistema**: la baseline sube igual (a 100% en
  Nebula). Si solo hubiera subido "mi" modo, la auditoría sería sospechosa.
- **El ablation de descripciones, repetido 5 veces, se ordena** ([descripciones.md](descripciones.md)):
  GraphRAG supera al vectorial en las cuatro celdas; la celda invertida de la tirada única
  era ruido.
- **La lección**: con el arnés corregido, la baseline de esquema entero es perfecta a 66
  tablas con un modelo de nube potente. La afirmación honesta ya no es "GraphRAG acierta
  más", sino "**GraphRAG iguala una baseline perfecta con 7,6× menos contexto**" — y gana
  donde la baseline no llega: modelos locales, esquemas opacos, coste a escala. Los números
  buenos de verdad no necesitan maquillaje; necesitan un arnés justo.

Fallos que permanecen tras la corrección: G-21 (déficit real de recuperación, 2 saltos;
mejora en SPEC-22), y G-25/N-13 como fallos de la métrica justa rescatados por la
equivalencia de forma consistente (empates en el corte / columnas identificativas
equivalentes).

## La lectura que me llevo

La brecha entre "la sensación de uso" y "las tablas" no era del sistema: era del arnés. Es la
tercera vez que el patrón se repite (el bug del 40%, las referencias que penalizaban consultas
mejores, y ahora esto), y la lección es la misma: **un agregado solo es creíble después de
abrir los casos**. La métrica justa sigue siendo útil como cota inferior objetiva y barata,
pero la métrica que responde a "¿el sistema contesta bien?" es la equivalencia — que es
exactamente lo que percibo usándolo.
