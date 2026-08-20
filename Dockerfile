# AgencyVoice — web (gateway + frontend)
FROM node:22-bookworm-slim

WORKDIR /app

# Dependências primeiro (cache de layer)
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

RUN npm run install:all

# Código
COPY . .

# Build do frontend (dist servido pelo Express)
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start:web"]
