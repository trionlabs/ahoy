FROM node:22

WORKDIR /app

COPY package.json ./
RUN npm install

# Debug: try loading the native binding directly
RUN node -e "try { require('/app/node_modules/@xmtp/node-bindings/dist/bindings_node.linux-x64-gnu.node'); console.log('NATIVE LOAD: SUCCESS') } catch(e) { console.log('NATIVE LOAD FAILED:', e.message) }"

COPY . .
RUN npm run build:client

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
