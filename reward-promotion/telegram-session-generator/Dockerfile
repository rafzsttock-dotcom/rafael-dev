FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js index.js ./

ENV NODE_ENV=production \
    SESSION_GENERATOR_HOST=0.0.0.0 \
    SESSION_GENERATOR_PORT=8091

EXPOSE 8091
USER node
CMD ["node", "server.js"]
