FROM node:22

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build:client

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
