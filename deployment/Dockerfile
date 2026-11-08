# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN node --input-type=module -e "import {VPS_INPUTS} from './scripts/vps-manifest.mjs'; import {existsSync} from 'node:fs'; if (VPS_INPUTS.some(p => p !== 'deployment/Dockerfile' && !existsSync(p))) throw Error('Reviewed build input missing');"
RUN npm run build:vps && npm run audit:vps

FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
WORKDIR /app
RUN command -v flock
ENV NODE_ENV=production HOMEPLANNER_DIST=/app/dist-vps
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bookshelf.js ./bookshelf.js
COPY --from=build /app/runtime ./runtime
COPY --from=build /app/server ./server
COPY --from=build /app/api ./api
COPY --from=build /app/shared ./shared
COPY --from=build /app/db ./db
COPY --from=build /app/deployment/volume-lock.sh ./deployment/volume-lock.sh
COPY --from=build /app/deployment/operations-lock.sh ./deployment/operations-lock.sh
COPY --from=build /app/deployment/verify-restored-access.cjs ./deployment/verify-restored-access.cjs
COPY --from=build /app/dist-vps ./dist-vps
USER 1000:1000
EXPOSE 3107
ENTRYPOINT ["/bin/sh", "/app/deployment/volume-lock.sh"]
CMD ["node", "runtime/server.cjs"]
