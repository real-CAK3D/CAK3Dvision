/**
 * CAK3Dvision: with GEV_HTTPS_CERT set, Vite serves HTTP/2, and HTTP/2 browsers
 * send `:authority` instead of a `Host` header. Every gate in the app (the host
 * check, the same-site and Provider Settings gates) reads `req.headers.host`,
 * so without this, real browsers get "Blocked request. This host is not
 * allowed." Copy `:authority` into `host` before any middleware runs. HTTP/2
 * forbids sending both with different values, so this never overrides a Host
 * the client actually sent.
 * @returns {import('vite').Plugin}
 */
export function h2HostPlugin() {
  return {
    name: 'cak3d-h2-host',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.prependListener('request', (req) => {
        const authority = req.headers?.[':authority'];
        if (!req.headers.host && typeof authority === 'string' && authority) {
          req.headers.host = authority;
        }
      });
    },
  };
}
