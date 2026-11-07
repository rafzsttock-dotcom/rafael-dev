FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js login.js ./

ENV TELEGRAM_SERVICE_HOST=0.0.0.0 \
    TELEGRAM_SERVICE_PORT=8090 \
    TELEGRAM_SESSION_DIR=/data/tg

EXPOSE 8090
CMD ["node", "server.js"]
