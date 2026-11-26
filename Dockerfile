FROM docker:27-cli AS docker-cli

FROM node:24-slim AS development

WORKDIR /app
ENV NODE_ENV=development PORT=5001
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5001
CMD ["npm", "run", "start:docker"]

FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build

FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/uploads/documents && chown -R node:node /app/uploads

USER node

ENV PORT=5001

EXPOSE 5001

CMD ["node", "dist/main"]
