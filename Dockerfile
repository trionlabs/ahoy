FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production=false

COPY . .
RUN npm run build:client

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
