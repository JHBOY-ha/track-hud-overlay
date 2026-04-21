import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'hud5-gpx-enrichment-api',
      configureServer(server) {
        server.middlewares.use('/output', serveOutputFiles(server.config.root));
        server.middlewares.use('/api/enrich-gpx', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          try {
            const body = await readJsonBody(req);
            const gpxText = String(body.gpxText ?? '');
            const inputName = String(body.inputName ?? 'track.gpx');
            if (!gpxText.trim()) throw new Error('Missing gpxText');

            const { enrichGpxText } = await import('./scripts/enrich-gpx-with-osm.mjs');
            const result = await enrichGpxText(gpxText, {
              inputName,
              outDir: path.resolve(server.config.root, 'output'),
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                geoJson: result.geoJson,
                paths: result.paths,
                pointCount: result.points.length,
                roadCount: result.roads.length,
              }),
            );
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use('/output', serveOutputFiles(server.config.root));
      },
    },
  ],
  server: { port: 5173 },
});

function serveOutputFiles(root: string) {
  const outputDir = path.resolve(root, 'output');

  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    try {
      const url = req.url ?? '';
      const pathname = decodeURIComponent(url.split('?')[0] ?? '').replace(/^\/+/, '');
      if (!pathname) return next();

      const filePath = path.resolve(outputDir, pathname);
      if (!filePath.startsWith(`${outputDir}${path.sep}`)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(filePath));
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  };
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.geojson':
      return 'application/geo+json; charset=utf-8';
    case '.gpx':
      return 'application/gpx+xml; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
