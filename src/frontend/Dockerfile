FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_CHAT_API_BASE_URL=/api
ARG VITE_CSRF_COOKIE_NAME=cfd_csrf
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_CHAT_API_BASE_URL=${VITE_CHAT_API_BASE_URL}
ENV VITE_CSRF_COOKIE_NAME=${VITE_CSRF_COOKIE_NAME}

RUN corepack pnpm build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
