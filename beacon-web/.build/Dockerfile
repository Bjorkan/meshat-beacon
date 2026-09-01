FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY beacon-web/package.json beacon-web/package.json
RUN npm ci --workspace=beacon-web
COPY beacon-web beacon-web
WORKDIR /repo/beacon-web
ENV VITE_API_BASE=__VITE_API_BASE__
ENV VITE_WS_URL=__VITE_WS_URL__
ENV VITE_MAP_CENTER=__VITE_MAP_CENTER__
ENV VITE_MAP_ZOOM=__VITE_MAP_ZOOM__
ENV VITE_DISABLED_TABS=__VITE_DISABLED_TABS__
ENV VITE_ENABLED_THEMES=__VITE_ENABLED_THEMES__
ENV VITE_APP_NAME=__VITE_APP_NAME__
ENV VITE_SKIP_SPLASH=__VITE_SKIP_SPLASH__
RUN npm run build

FROM caddy:2-alpine
COPY beacon-web/.build/Caddyfile /etc/caddy/Caddyfile
COPY beacon-web/.build/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=build /repo/beacon-web/dist /srv
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
