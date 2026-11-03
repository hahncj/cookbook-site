# Alternative host (decision D16 / AC-039): Node + SQLite file.
# Build from the repository root:  docker build -f hosting/node/Dockerfile -t cookbook .
FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native module; build tools stay in this stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g npm@11.21.1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:node && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/cookbook.db MEDIA_DIR=/data/media
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/hosting/node/server.js ./hosting/node/server.js
VOLUME /data
EXPOSE 3000
CMD ["node", "hosting/node/server.js"]
