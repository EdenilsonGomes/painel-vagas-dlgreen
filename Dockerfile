FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Fontes necessárias para o Sharp/librsvg renderizar os textos das artes PNG.
RUN apk add --no-cache fontconfig ttf-dejavu

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
