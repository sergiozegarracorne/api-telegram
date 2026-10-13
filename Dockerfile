FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencias nativas para compilar better-sqlite3 si no hay binario precompilado
RUN apk add --no-cache --virtual .build python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && apk del .build

COPY src ./src
COPY public ./public

ENV DB_PATH=/app/data/app.db
VOLUME ["/app/data"]
EXPOSE 3000

USER node
CMD ["node", "src/server.js"]
