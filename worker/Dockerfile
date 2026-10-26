# ffmpeg (Debian bookworm) + Node 20 — the external media worker for MediaFetch.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

RUN mkdir -p /app/data
EXPOSE 8080

# Basic filesystem isolation: run as unprivileged user.
RUN useradd -m -u 10001 worker && chown -R worker:worker /app
USER worker

CMD ["node", "server.mjs"]
