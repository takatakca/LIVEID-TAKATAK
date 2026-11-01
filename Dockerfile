# TAKATAK LIVE ID — production image (Coolify / any Docker host).
# Face models, OCR data and the speech recognizer are inside the image: nothing is downloaded at runtime.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    POCKETSPHINX_PYTHON=/opt/speech/bin/python
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
 && python3 -m venv /opt/speech \
 && /opt/speech/bin/pip install --no-cache-dir pocketsphinx==5.1.1 \
 && apt-get purge -y --auto-remove \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
COPY web ./web
COPY migrations ./migrations
COPY py ./py
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
