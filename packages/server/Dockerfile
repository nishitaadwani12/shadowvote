# Build context is the repo root (monorepo). Build with:
#   docker build -f packages/server/Dockerfile -t shadowvote-server .
FROM node:20-alpine

WORKDIR /app

# Install all workspace deps (tsx runs the server, so dev deps are needed).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci

# Source
COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "-w", "@shadowvote/server"]
