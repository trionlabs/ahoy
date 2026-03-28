FROM node:22-alpine

RUN apk add --no-cache bash

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build:client

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
