# syntax=docker/dockerfile:1

# Melon in a container: one image, one port, the full app.
#
# This builds the SERVER target, not the hosted web build. That is deliberate.
# The hosted build runs the orchestrator inside the page, which cannot reach a
# local Ollama, so it greys local runtimes out — exactly the models a
# self-hosted Melon exists to talk to. Running the server here means model
# requests leave this process, not the browser, and CORS never enters into it.

# ---- build the UI ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so this layer stays cached until dependencies actually
# change. All three workspace manifests are needed or `npm ci` refuses.
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .
# Typechecks core and server, then bundles the client. No VITE_MELON_TARGET,
# so this is the "server" target: the UI calls /api/... on this container.
RUN npm run build

# ---- run ------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# @melon/core is published as TypeScript source on purpose — core/package.json
# points `main` at ./src/index.ts so Vite can compile it into the browser
# build. Plain `node` cannot load that, so the server runs through tsx, which
# is why tsx is a dependency of @melon/server rather than a dev dependency.
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev && npm cache clean --force

COPY core/src core/src
COPY server/src server/src
COPY --from=build /app/client/dist client/dist

# A container's own 127.0.0.1 is reachable only from inside it, so binding
# there would publish a port that answers nothing. Who can actually connect is
# decided by `docker run -p` on the host side, not by this line.
ENV MELON_BIND=0.0.0.0
ENV MELON_SERVER_PORT=8080
EXPOSE 8080

USER node

# Lets `docker ps` and compose report a wedged app instead of a happy-looking
# container serving errors.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MELON_SERVER_PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
