FROM node:22-alpine
WORKDIR /usr/server
COPY package*.json .
RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache git
RUN npm ci --only=production
COPY . .
ENV port=9000
CMD ["npm", "start"]
