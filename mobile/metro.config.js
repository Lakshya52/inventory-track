const http = require('http');
const { URL } = require('url');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * In Expo Go the phone can always reach the Metro dev server, but on some
 * Windows setups an inbound firewall rule for the API port (3001) is missing.
 * Proxy API and upload traffic through Metro so the app only needs the dev
 * server port. Set EXPO_API_PROXY_TARGET to override the backend address.
 */
const proxyTarget = new URL(process.env.EXPO_API_PROXY_TARGET || 'http://127.0.0.1:3001');
const proxyIsSecure = proxyTarget.protocol === 'https:';
const proxyClient = proxyIsSecure ? require('https') : http;
const proxyPort = Number(proxyTarget.port || (proxyIsSecure ? 443 : 80));

function isApiPath(url) {
  const path = (url || '').split('?')[0];
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/uploads' ||
    path.startsWith('/uploads/')
  );
}

function proxyRequest(req, res) {
  const proxyReq = proxyClient.request(
    {
      protocol: proxyTarget.protocol,
      hostname: proxyTarget.hostname,
      port: proxyPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: proxyTarget.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(
      JSON.stringify({
        error: 'The local API server is not reachable.',
        detail: error.message,
      })
    );
  });

  req.pipe(proxyReq);
}

if (process.env.NODE_ENV !== 'production') {
  config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
    if (isApiPath(req.url)) {
      proxyRequest(req, res);
      return;
    }
    return middleware(req, res, next);
  };
}

module.exports = config;
