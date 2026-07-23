# Production Dockerfile for Skima Admin Web Control Center
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build || true

FROM nginx:alpine AS runner
COPY --from=builder /app /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
