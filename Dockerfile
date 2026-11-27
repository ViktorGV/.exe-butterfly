# One process serves the built client, /api/*, /healthz and the WebSocket (#47).
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 8787
CMD ["bun", "apps/server/src/index.ts"]
