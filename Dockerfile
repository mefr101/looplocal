# Portable container for any host that runs Docker.
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/looplocal.db \
    UPLOAD_DIR=/data/uploads

# Mount a persistent volume at /data or the database is lost on restart.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
