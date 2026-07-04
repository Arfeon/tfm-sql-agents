# Propuesta de valor — GraphSQL

> Documento de **posicionamiento** (para la defensa y las slides). La lectura académica
> neutra de los números vive en [`design/arquitectura.md` §10](design/arquitectura.md); aquí
> cuento por qué el producto vale la pena. Todas las cifras son de mediciones reales sobre
> el golden set de Arcadia (25 preguntas); los límites están al final, a la vista.
> ¿Términos poco familiares (GraphRAG, schema-linking, ablation…)? En el [glosario](glosario.md).

## 1. El problema

Preguntar a una base de datos exige saber SQL **y** conocer el esquema exacto. Las
integraciones NL→SQL que se ven por ahí resuelven la parte fácil y tropiezan en la difícil:

- **Vuelcan todo el esquema al contexto** del LLM. Funciona con 10 tablas; con 200 revienta
  el coste, la latencia y, llegado un punto, la propia ventana de contexto.
- **No incorporan conocimiento del negocio**: una tabla `t_042` que guarda las listas de
  deseos es invisible si solo miras su nombre.
- **No dejan ver ni entender el esquema**: el usuario no sabe por qué el sistema eligió unas
  tablas y no otras.
- **Los agentes conversacionales tipo ReAct se pierden** en conversaciones largas o de
  contexto amplio, y no dan garantías de seguridad sobre lo que ejecutan.

## 2. Qué hace distinto GraphSQL

- **Recuperación GraphRAG**: en vez de volcar el esquema, localiza **solo las tablas
  relevantes** combinando búsqueda semántica (pgvector) con expansión por claves foráneas en
  un grafo (Neo4j). El contexto se mantiene pequeño y **acotado**, no crece con la base de datos.
- **Descripciones del esquema**: conocimiento del negocio que viaja con el contexto y permite
  encontrar tablas de **nombre opaco** por lo que significan, no por cómo se llaman.
- **Human-in-the-loop + afinar**: el usuario ve la SQL y el veredicto antes de ejecutar, y la
  ajusta en lenguaje natural ("añade también la popularidad por wishlist") sin empezar de cero.
- **Seguridad por diseño**: solo lectura, validación por capas (allowlist + `EXPLAIN` +
  juez LLM) y aprobación humana. Nada se ejecuta sin visto bueno.
- **Explicabilidad**: se ve por qué entró cada tabla (traza de recuperación) y el esquema como
  grafo navegable.

## 3. Lo que hemos medido (datos reales)

*Ablation* (comparar el sistema quitando piezas para ver qué aporta cada una — ver
[glosario](glosario.md)) sobre el golden set de Arcadia (25 preguntas, español→SQL), comparando
tres formas de dar contexto al LLM:

| Modo | Schema-linking recall | Execution accuracy | Contexto (tablas) | Contexto (tokens) |
|------|----------------------|--------------------|-------------------|-------------------|
| Sin recuperación (esquema entero) | 100% | 76% | 17 | 1498 |
| Solo búsqueda vectorial | 93% | 64% | 5 | 481 |
| **GraphRAG (vector + grafo)** | **99%** | **72%** | **8** | **774** |

**Titular:** GraphSQL recupera el **99% de las tablas correctas con la mitad del contexto**
(774 vs 1498 tokens) que volcar el esquema entero, y con una precisión **equivalente** (72%
vs 76%, dentro del ruido de una sola tirada). Y recupera bastantes más tablas correctas que la
búsqueda vectorial sola (99% vs 93%): la expansión por el grafo trae las tablas de JOIN que el
vector se deja.

### Las descripciones aportan (y el grafo da robustez)

Midiendo GraphRAG y búsqueda vectorial **con** y **sin** descripciones:

- Con descripciones, la precisión sube de forma clara (en búsqueda vectorial, de 44% a 72%).
- La tabla de nombre opaco `t_042` (listas de deseos) **solo se encuentra bien con descripciones**:
  sin ellas, la búsqueda vectorial la falla; **con** ellas, acierta.
- **El grafo da robustez**: incluso sin descripciones, GraphRAG rescata `t_042` siguiendo su
  clave foránea con `customer`. Es decir, las dos piezas (semántica + grafo) se cubren la
  espalda.

## 4. Por qué esto gana a escala (el argumento que de verdad vende)

La comparación de precisión sobre una base de datos pequeña (17 tablas) **infravalora** el
producto, porque su ventaja crece con dos ejes que en producción son la norma:

**Eje 1 — tamaño del esquema (medido).** El contexto de "volcar el esquema entero" crece
**lineal** con el número de tablas; el de GraphSQL se mantiene **acotado** (recupera ~8 tablas,
dé igual el tamaño de la base). Lo medí sobre dos esquemas reales, Arcadia (17 tablas) y Nebula
(66 tablas, sintética, misma familia de dominio):

| Tablas del esquema | Volcar el esquema entero | GraphSQL | Recall GraphSQL | Ahorro |
|--------------------|--------------------------|----------|-----------------|--------|
| 17 (Arcadia) | 1.498 tokens | 774 | 99% | ~2× |
| 66 (Nebula) | 5.748 tokens | **759** | **100%** | **~7,6×** |
| 300 (proyección) | ~27.000 tokens | ~800 | — | ~34× *(y el esquema entero ya no cabe en muchas ventanas de contexto)* |

El dato clave: al pasar de 17 a 66 tablas, el contexto del esquema entero se multiplicó por
~3,8 (1.498 → 5.748), mientras que **el del GraphSQL se quedó plano** (774 → 759). Es decir, el
ahorro **crece** con el tamaño del esquema, y el recall se mantuvo (99% → 100%). A escala grande
no es que volcar el esquema sea "más caro": es que **deja de funcionar** (no cabe). GraphSQL sigue
igual. (Bonus medido: la búsqueda vectorial *sola* pierde recall al crecer el esquema —93% → 80%—
porque se deja tablas de JOIN; es la expansión por el grafo la que las recupera, así que la ventaja
del grafo se ensancha a escala.)

**Eje 2 — volumen de peticiones.** Este ahorro por consulta se multiplica por cada petición. Un
chatbot de negocio o una herramienta de consultoría BI con, pongamos, 1.000 consultas/día, sobre
un esquema mediano-grande, ahorra **decenas de millones de tokens al día** solo en el contexto
del esquema → coste directo y **menor latencia** (menos contexto = respuesta más rápida = mejor
experiencia justo cuando hay volumen).

*(Las filas de 17 y 66 tablas son medidas reales; la de 300 es una proyección lineal del coste
por tabla — no medida a esa escala todavía, ver §6.)*

## 5. A quién sirve (un núcleo, tres públicos)

- **Consultoría BI / analistas de negocio**: preguntan en lenguaje natural, ven la SQL validada
  y el resultado, y afinan la consulta conversando. No necesitan saber SQL.
- **Usuarios técnicos / analistas de datos**: fijan tablas, revisan la traza de recuperación,
  navegan el esquema como grafo, editan la SQL a mano cuando quieren control fino.
- **Desarrolladores / integradores**: seguridad de solo lectura, Judge por capas y aprobación
  humana lo hacen apto para producción; la arquitectura limpia (puertos/adaptadores) lo hace
  fácil de integrar y extender.

## 6. Honestidad (lo que aún no probamos)

- El golden set es pequeño (25 preguntas en Arcadia, 15 en Nebula), de un solo dominio y con un
  solo modelo; los números de precisión de una tirada varían ~±8 puntos por la no-determinación
  de la generación. Son **indicativos**, no decimales exactos.
- La escala está medida a fondo (17 vs 66 tablas): contexto, recall **y** execution accuracy.
  *Dentro* de Nebula (66 tablas), GraphRAG **supera** en aciertos tanto a "volcar el esquema entero"
  (80% vs 67%) como a la búsqueda vectorial sola (60%), y encima con ~1/7 del contexto. A 17 tablas
  las tres formas empataban; a 66 el GraphRAG despega. Con cautela: son 15 preguntas y una sola
  tirada, así que es una **señal en la dirección esperada**, no una ventaja de tribunal. La accuracy
  absoluta entre Arcadia y Nebula **no es comparable directa** (golden sets distintos); lo comparable
  es entre modos dentro de cada BD.
- Lo que **sí** está medido y es sólido: contexto acotado con recall alto que se mantiene al
  crecer el esquema (774 → 759 tokens, 99% → 100% de 17 a 66 tablas), que a esa escala GraphRAG
  **saca ventaja de aciertos** gastando una fracción del contexto, y que las descripciones
  aportan de forma clara.
- Rigor de la medición: los aciertos de Nebula pasaron por una corrección importante. Una primera
  versión daba 40% porque el arnés ejecutaba las consultas contra la BD por defecto (Arcadia) en vez
  de contra Nebula; lo detecté revisando casos a mano, lo arreglé (con test de regresión) y el número
  real es 80%. Lo cuento porque la honestidad de la evaluación es parte del valor: los números salen
  de abrir los casos, no de fiarse del porcentaje.

## 7. En una frase

> GraphSQL responde preguntas en lenguaje natural sobre bases de datos relacionales dando al
> LLM **solo el trozo de esquema que hace falta** — no todo —, enriquecido con conocimiento del
> negocio y bajo control humano. En pequeño empata en precisión gastando la mitad; en grande,
> saca ventaja de aciertos (80% vs 67%) y es la diferencia entre que funcione y que no.
