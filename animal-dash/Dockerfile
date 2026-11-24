# Single image serving both the game client and the Colyseus server.
FROM node:22-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY client/package*.json ./client/
COPY server/package*.json ./server/
RUN npm --prefix client ci && npm --prefix server ci
COPY client ./client
COPY server ./server
RUN npm --prefix client run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2567 CLIENT_DIST=/app/client/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/dist ./client/dist
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:2567/health || exit 1
CMD ["node", "server/dist/index.js"]
