FROM node:22-alpine
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server server
COPY public public
ENV NODE_ENV=production DB_PATH=/data/app.db
VOLUME /data
USER node
CMD ["node","--disable-warning=ExperimentalWarning","server/server.js"]
