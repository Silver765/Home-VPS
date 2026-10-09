FROM node:20-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production PORT=3010 DATA_DIR=/data
EXPOSE 3010
ENTRYPOINT ["/entrypoint.sh"]
