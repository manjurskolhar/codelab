FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
COPY seed ./seed
COPY tools ./tools
ENV PORT=8080
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server.js"]
