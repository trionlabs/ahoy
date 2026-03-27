FROM node:22

WORKDIR /app

COPY package.json ./
RUN npm install

# Debug: check if XMTP native binary exists and what it needs
RUN ls -la node_modules/@xmtp/node-bindings/dist/bindings_node.linux* 2>/dev/null || echo "NO LINUX BINDINGS FOUND" && \
    ldd node_modules/@xmtp/node-bindings/dist/bindings_node.linux-x64-gnu.node 2>/dev/null || echo "LDD FAILED"

COPY . .
RUN npm run build:client

ENV PORT=8080
CMD ["npx", "tsx", "src/index.ts"]
