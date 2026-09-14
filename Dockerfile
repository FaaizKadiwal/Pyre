# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

USER node
EXPOSE 3000

# Platforms that inject their own PORT are respected; 3000 is the default.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD sh -c 'wget -qO- "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1'

CMD ["node", "server/server.js"]
