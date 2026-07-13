# Imagen del CLI de GraphSQL para la demo: permite probar el proyecto entero solo
# con Docker, sin instalar Node. No sustituye a la instalación normal (npm start /
# gsql); es el camino "evalúalo en cinco minutos". Se usa desde el compose:
#
#   docker compose --profile demo run --rm cli
#
# La infraestructura (Postgres y Neo4j) sigue viniendo del docker-compose.yml de
# siempre; este contenedor solo lleva la aplicación, y arranca cuando los otros dos
# están healthy (depends_on), por eso desactiva su preflight de Docker.

FROM node:20-slim

# Dependencias primero, para que la capa se cachee mientras no cambie el package.json.
# --ignore-scripts evita el "prepare" de husky (hooks de git, sin sentido en la imagen).
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# La aplicación y los recursos que espera en la raíz del proyecto (/app).
COPY backend/tsconfig.json ./
COPY backend/bin ./bin
COPY backend/src ./src
COPY agents /app/agents

# Descripciones de la demo: SOLO el ejemplo, copiado fichero a fichero a propósito.
# La carpeta descriptions/ local puede contener descripciones de una BD real
# (esquema confidencial de empresa, fuera del repo por .gitignore) y no debe
# entrar JAMÁS en una imagen. El .dockerignore la excluye del contexto entero.
COPY descriptions/descriptions.example.json /app/descriptions/descriptions.json

# Configuración por defecto de la demo; docker compose la afina con variables de
# entorno (hosts de la red interna, contraseñas, API key), que tienen prioridad
# sobre el .env porque dotenv nunca pisa variables ya definidas.
COPY .env.example /app/.env
ENV GRAPHSQL_SKIP_INFRA_PREFLIGHT=true

CMD ["node", "bin/gsql.js"]
