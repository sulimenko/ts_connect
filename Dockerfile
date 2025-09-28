FROM node:22.18.0-alpine
WORKDIR /usr/server
COPY package*.json .
RUN apk add --no-cache git
RUN npm ci --only=production
COPY . .
ENV port=9000
CMD ["npm", "start"]
