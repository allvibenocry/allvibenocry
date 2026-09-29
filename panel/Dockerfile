# The control panel's image (D63): built on the machine from the official
# Node.js 24 image, pinned by index digest (D40), with the panel's own files
# and nothing from npm. It runs as the panel's own user, which `docker run`
# gives it, on an internal network, with only the engine's socket mounted.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
COPY server.mjs /panel/server.mjs
COPY static /panel/static
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "/panel/server.mjs"]
