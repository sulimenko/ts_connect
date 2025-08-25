FROM node:22.18.0-alpine
WORKDIR /usr/server
COPY package*.json .
RUN apk add --no-cache git
RUN npm ci --only=production
COPY . .
EXPOSE 8000
EXPOSE 8001
EXPOSE 8002
CMD ["node", "server.js"]
