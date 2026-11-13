import { defineConfig } from 'vite';

// Production builds get a Content-Security-Policy: everything the game needs ships with it, so nothing may load
// from, or talk to, another origin. Not applied in dev, where Vite injects inline scripts and a websocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = () => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: './',
  // localhost only by default; pass --host to share on the local network
  server: { port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  plugins: [csp()],
});
