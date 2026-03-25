# Stage 1: Build React frontend
FROM node:20-alpine AS builder

ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.html vite.config.js ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production image with Express API + built frontend
FROM node:20-alpine

WORKDIR /app

COPY api/ ./api/
COPY --from=builder /app/dist ./dist

WORKDIR /app/api
RUN npm install --production

WORKDIR /app

EXPOSE 3000

CMD ["node", "api/server.js"]
