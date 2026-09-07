# KeepAliveMC Pro - Production Dockerfile
# Optimized for Railway, Render, Fly.io

FROM node:20-alpine AS base

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json ./
RUN npm install --production --silent && npm cache clean --force

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy dependencies from base
COPY --from=base /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

USER nodejs

EXPOSE 3000

CMD ["node", "server.js"]
