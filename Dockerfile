FROM node:22-alpine

RUN apk add --no-cache bash

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build:client
RUN mkdir -p public/landing && cd landing && npm install && npm run build && cp -r build/* ../public/landing/ && cd ..

# Badwords filter — baked into image
RUN echo '["bomb","kill","murder","terrorist","suicide","shooting","kidnap","ransom","exploit","hack","phishing","scam","fraud","launder","trafficking","child abuse","swat","threat","extort"]' > badwords.json

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
