# The guestbook's image. Pinned by digest, like every image the suite uses.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .

# Which version this is, set by the suite when it builds: a fact about the
# image, not a setting.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION NODE_ENV=production PORT=3000

USER node
EXPOSE 3000
CMD ["node", "server.js"]
