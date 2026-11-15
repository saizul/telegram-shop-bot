# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

# ---- runtime ----
FROM node:24-alpine
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    CATALOG_FILE=/app/data/catalog.json
WORKDIR /app
# No runtime dependencies: the compiled app only uses Node built-ins (node:sqlite, node:http, fetch).
COPY package.json ./
COPY --from=build /app/dist/src ./dist/src
COPY examples/catalog.json ./examples/catalog.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
