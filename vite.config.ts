import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        hud: path.resolve(__dirname, 'index.html'),
        routeLab: path.resolve(__dirname, 'route-lab.html'),
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'hud5-gpx-enrichment-api',
      configureServer(server) {
        server.middlewares.use('/output', serveOutputFiles(server.config.root));
        server.middlewares.use('/api/road-network', async (req, res) => {
          try {
            const url = new URL(req.url ?? '', 'http://localhost');
            const lat = Number(url.searchParams.get('lat'));
            const lon = Number(url.searchParams.get('lon'));
            const radiusM = Number(url.searchParams.get('radiusM'));
            if (![lat, lon, radiusM].every(Number.isFinite)) throw new Error('Invalid center or radius');
            if (radiusM < 100 || radiusM > 5000) throw new Error('Radius must be between 100 and 5000 metres');
            const latDelta = radiusM / 110540;
            const lonDelta = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
            const minLat = lat - latDelta, minLon = lon - lonDelta;
            const maxLat = lat + latDelta, maxLon = lon + lonDelta;
            const sourceUrl = `https://www.openstreetmap.org/api/0.6/map?bbox=${minLon},${minLat},${maxLon},${maxLat}`;
            const response = await fetch(sourceUrl, {
              headers: {
                Accept: 'application/xml,text/xml,*/*',
                'User-Agent': 'HUD5RouteGenerator/0.1',
              },
            });
            if (!response.ok) throw new Error(`OpenStreetMap ${response.status}`);
            const roads = parseRoadNetworkXml(await response.text());
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ roads, sourceUrl }));
          } catch (error) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });
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
            const coordinateSystem = String(body.coordinateSystem ?? 'wgs84');
            if (!gpxText.trim()) throw new Error('Missing gpxText');

            const { enrichGpxText } = await import('./scripts/enrich-gpx-with-osm.mjs');
            const result = await enrichGpxText(gpxText, {
              inputName,
              outDir: path.resolve(server.config.root, 'output'),
              coordinateSystem,
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

function parseRoadNetworkXml(xml: string) {
  const nodes = new Map<string, { nodeId: string; lat: number; lon: number }>();
  for (const match of xml.matchAll(/<node\b([^>]*)\/?>/g)) {
    const attrs = xmlAttrs(match[1]);
    const lat = Number(attrs.lat), lon = Number(attrs.lon);
    if (attrs.id && Number.isFinite(lat) && Number.isFinite(lon)) {
      nodes.set(attrs.id, { nodeId: attrs.id, lat, lon });
    }
  }
  const roads = [];
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attrs = xmlAttrs(match[1]);
    const body = match[2];
    const tags: Record<string, string> = {};
    for (const tagMatch of body.matchAll(/<tag\b([^>]*)\/?>/g)) {
      const tag = xmlAttrs(tagMatch[1]);
      if (tag.k) tags[tag.k] = tag.v ?? '';
    }
    if (!tags.highway) continue;
    const points = [...body.matchAll(/<nd\b([^>]*)\/?>/g)]
      .map(nd => nodes.get(xmlAttrs(nd[1]).ref))
      .filter((point): point is { nodeId: string; lat: number; lon: number } => !!point);
    if (points.length > 1) {
      roads.push({
        id: attrs.id ?? `way:${roads.length}`,
        name: tags.name ?? tags['name:zh'] ?? tags.ref ?? '未命名道路',
        highway: tags.highway,
        points,
      });
    }
  }
  return roads;
}

function xmlAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return attrs;
}
