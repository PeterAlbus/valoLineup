import { createServer } from 'vite';
import { browserFixture } from './fixtures/browser.mjs';
import { fixtureImage } from './fixtures/content.mjs';

const fixture = await browserFixture();
const bytes = await fixtureImage();
const server = await createServer({
  server: { host: '127.0.0.1', port: Number(process.env.TEST_PORT ?? 4174), strictPort: true },
  plugins: [{
    name: 'synthetic-lineup-test-data', enforce: 'pre',
    load(id) {
      if (id.replaceAll('\\', '/').split('?')[0].endsWith('/src/data/content.json')) return JSON.stringify(fixture);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/__test_fixture') { res.end('valo-lineup-synthetic-v1'); return; }
        if (url.pathname === '/src/data/content.json' && !url.searchParams.has('import')) {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture)); return;
        }
        if (Object.hasOwn(fixture.mediaBytes, url.pathname.slice(1))) {
          res.setHeader('Content-Type', 'image/webp'); res.end(bytes); return;
        }
        next();
      });
    },
  }],
});
await server.listen();
server.printUrls();
console.log('Synthetic lineup test server: live lineup files are not loaded or changed.');
