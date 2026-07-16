FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server/data ./server/data
COPY --from=build /app/firebase-applet-config.json ./firebase-applet-config.json

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
