# jsontype on any Docker host (e.g. Render). Build from this folder:
#   docker build -t jsontype . && docker run -p 3000:3000 -v jsontype:/data jsontype
FROM oven/bun:1.3-slim
WORKDIR /app

# Lockfile first so the install layer caches, and --frozen-lockfile fails the
# build instead of silently resolving different versions. There are no runtime
# dependencies; --production skips the typecheck-only dev dependencies.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Bundle the frontend into src/page.gen.ts, which server.ts imports.
COPY . .
RUN bun run build

# Shares live here; mount a persistent disk at /data or they reset on redeploy.
ENV NODE_ENV=production \
    JSONTYPE_DB=/data/jsontype.sqlite
RUN mkdir -p /data

# The server listens on $PORT (Render sets it), falling back to 3000.
EXPOSE 3000
CMD ["bun", "server.ts"]
