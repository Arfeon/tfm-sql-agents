# Recuperación por capas — el camino desde el top-K vectorial

- **Fecha**: 2026-07-10
- **Decisión formal (resumen)**: [`docs/design/arquitectura.md`](../../design/arquitectura.md) §6 (SPEC-26)
- **Objetivo de esta nota**: dejar por escrito *por qué* acabé necesitando varias capas de recuperación, no solo *qué* implementé. Es la parte del proyecto de la que más aprendí, y la que quiero contar en la memoria y en las slides.

## El punto de partida: una recuperación que parecía suficiente

La recuperación de SPEC-04 es la mitad "de libro" del GraphRAG: vectorizo cada tabla, busco las top-K candidatas por significado en pgvector y las expando por claves foráneas en Neo4j. Sobre mis bases de prueba (Arcadia, ~17 tablas; Nebula, ~66) funcionaba bien: preguntaba por "clientes" y encontraba `customer`, casaba español con un esquema en inglés, y el contexto salía pequeño y correcto.

Eso me dio una confianza que resultó ser falsa. Las bases de prueba tienen nombres limpios y pocas tablas, así que el schema linking es casi trivial: la tabla que buscas se parece al texto de la pregunta y punto. El método no estaba resuelto; estaba **sin poner a prueba de verdad**.

## Dónde se rompió: el *entity-pivot*

La prueba de verdad llegó al apuntar la recuperación contra el ERP real de la empresa (~800 tablas, nombres opacos, sin descripciones). El caso que lo destapó fue una pregunta tan normal como esta:

> «¿Qué **abonado** tiene más líneas de fibra?»

La frase habla sobre todo de las *líneas de fibra*, así que su embedding queda cerca de las decenas de tablas de ese dominio, y la tabla de abonados —que es **la entidad por la que se pregunta**, el sujeto de la frase— cae al puesto ~179 del ranking. Con un top-K de 5, ni aparece.

Lo llamo *entity-pivot*: el sustantivo pivote de la pregunta queda enterrado bajo el tema dominante de la frase. Y lo que me costó ver es que **no era un problema de afinar un parámetro**. Subir el top-K a 30 no trae la tabla de clientes: trae 30 tablas del tema dominante. El recall no mejora porque el ranking está midiendo lo que no debe.

## La lección de fondo: la similitud mide el *tema*, no el *papel*

Este es el aprendizaje que lo ordena todo. Un embedding de una tabla captura *de qué va* esa tabla. La similitud coseno con la pregunta mide, por tanto, **cuánto comparte la tabla el tema de la frase** — no *qué papel juega* esa tabla en la consulta. En un esquema pequeño y bien nombrado las dos cosas coinciden casi siempre, y por eso el método parecía bastar. En un esquema grande y ambiguo se separan, y ahí es donde se ve que la similitud sola es ciega a la estructura de la pregunta.

Una vez formulado así, el resto casi se deduce: si un solo método (la similitud) mide una sola cosa (el tema), necesito **otras señales que midan las otras cosas** que importan — las palabras exactas, la estructura del esquema, y el razonamiento sobre qué hace falta para responder.

## Los callejones sin salida

Antes de llegar a las capas probé (o descarté sobre el papel) lo obvio, y anotar por qué no bastaba fue parte del aprendizaje:

- **Subir el top-K**: ya dicho, amplía el tema dominante, no rescata el pivote.
- **Bajar el umbral de similitud**: mete ruido sin resolver el sesgo; la tabla correcta sigue por debajo de las incorrectas.
- **Re-pesar el vector a mano** (dar más peso a nombres de tabla): frágil, específico de cada esquema, y no generaliza.

El patrón común de todos los callejones: intentaba arreglar el *síntoma* (la tabla no rankea) sin tocar la *causa* (estoy midiendo la señal equivocada).

## Las capas, y qué me enseñó cada una

La solución final son cuatro capas, y lo interesante es que cada una nació de una carencia concreta de la anterior. La mecánica está en arquitectura §6; aquí me quedo con lo que aprendí de cada paso.

1. **Ranking léxico (recall por palabras).** Si preguntas por "cliente" y existe una tabla `clients`, eso es una señal que ningún embedding debería poder enterrar. El léxico compara *letras* (por trigramas), no significado; es infalible cuando las palabras coinciden y ciego ante sinónimos — justo el complemento del denso. Aprendizaje: no se trataba de *sustituir* la búsqueda semántica, sino de *sumarle* una señal que el denso no tiene.

2. **Fusión por *Reciprocal Rank Fusion*.** Aquí me ahorré un problema que no vi venir: cómo combinar dos rankings con escalas incomparables sin inventar y calibrar pesos por cada base de datos. El RRF ignora los scores y mira solo las *posiciones*. Aprendizaje pequeño pero valioso: a veces la solución robusta no es afinar un peso, sino elegir un método que no tenga pesos que afinar.

3. **Expansión por grafo (recall por estructura).** Cambié de fuente de señal por completo: dejé de mirar el texto y miré las FKs reales. Aunque una tabla no se parezca en nada a la pregunta, si el esquema dice que es imprescindible para el JOIN (un hub, una tabla puente, la dimensión que un ancla referencia), hay que traerla. Aprendizaje: el grafo aporta un recall que la similitud, por diseño, nunca dará.

4. **Selector con LLM (precisión por razonamiento).** Las tres capas anteriores dan *recall*: consiguen que la tabla correcta esté *entre* las candidatas. Pero el contexto final debe ser pequeño, y recortarlo por similitud vuelve a caer en el sesgo del principio. Un LLM que *lee* la pregunta y *elige* razonando distingue lo que ninguna medida de parecido distingue. Aprendizaje: hay un punto en el que el problema deja de ser de *búsqueda* (recall) y pasa a ser de *criterio* (precisión), y ahí el razonamiento gana a la métrica.

## El meta-aprendizaje

Por encima de las capas, cuatro cosas que me llevo y que creo que son lo que de verdad merece estar en el TFM:

- **El techo no es el algoritmo, es la documentación del esquema.** Midiéndolo sobre el ERP real vi que, con una sola frase de descripción, una tabla sube del puesto ~60 al top del ranking. Es decir: por muchas capas que ponga, el sostén real de la recuperación es que el esquema esté descrito. De ahí salió la idea del generador automático de descripciones (SPEC-27), que no es una mejora incremental sino *la palanca* que convierte una base donde nadie recupera bien en una donde cualquier método decente funciona.

- **Llegué por evidencia propia al mismo sitio que el estado del arte.** Los sistemas NL2SQL que sí se enfrentan a esquemas grandes (los de Spider 2.0 / BIRD: CHESS, CodeS…) convergen en la misma receta —recuperación densa + señal léxica + un LLM que filtra tablas + poda—. No lo copié: llegué ahí porque cada capa resolvía un fallo que veía con mis propios ojos. Y descubrí de paso que los benchmarks académicos clásicos (Spider 1.0) tienen esquemas de ~5-7 tablas, lo que explica por qué el problema no aparece en la literatura hasta que subes de escala.

- **El cuello de botella no es escribir la SQL, es encontrar las tablas.** Es contraintuitivo: uno esperaría que lo difícil fuera generar SQL correcto. En un esquema grande, si le das al modelo las tablas correctas, la SQL sale; si no se las das, no hay generador que la salve. El grueso del esfuerzo (y del interés) del proyecto se fue al schema linking, no al NL→SQL.

- **La disciplina de las palancas.** Todo lo nuevo va detrás de opciones apagadas por defecto, de modo que el arnés de evaluación sigue midiendo SPEC-04 puro y las métricas antiguas siguen siendo comparables. Aprendizaje de método: cuando cambias el sistema que estás midiendo, o preservas una vía de medir lo de antes, o pierdes la capacidad de saber si mejoraste.

## Lo que queda abierto

- **Recuperación multi-consulta por entidades**: atacar el *entity-pivot* en su raíz extrayendo las entidades de la pregunta y lanzando un top-K por entidad, en vez de rescatar a la víctima después.
- **Particionado por dominios**: detección de comunidades sobre el grafo de FK para que el pivote no compita contra 800 tablas sino contra las de su módulo.
- **Medir las capas por separado**: un golden set pequeño sobre el ERP real para cuantificar la contribución de cada palanca (léxico solo, +grafo, +selector), que hoy solo tengo validada de forma cualitativa.

Estas tres están recogidas como trabajo futuro en [`SPEC.md`](../../design/SPEC.md) («Mejoras futuras»); las dejo aquí porque son la continuación natural del razonamiento de esta nota.
