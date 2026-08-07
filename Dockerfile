FROM node:24-alpine
WORKDIR /usr/server
COPY package*.json .
RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache git
RUN npm ci --omit=dev
COPY . .
ENV port=9000
CMD ["npm", "start"]
