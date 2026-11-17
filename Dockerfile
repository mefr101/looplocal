# Runs on x86 and Arm hosts (Oracle's free Arm machines included): nothing here needs compiling.
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# The database and uploaded photos live in /data. Mount a volume there or they are lost on restart.
RUN mkdir -p /data/uploads && chown -R node:node /data
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/looplocal.db \
    UPLOAD_DIR=/data/uploads
VOLUME ["/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
