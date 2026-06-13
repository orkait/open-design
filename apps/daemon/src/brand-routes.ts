// Brands HTTP surface — list / extract (SSE) / detail / delete / logo.
//
// A "brand" = brand metadata (brand.json + meta.json under
// `<brandsRoot>/<id>/`) PLUS a registered user design system. These routes are
// a thin HTTP wrapper over the deterministic engine in `./brands/index.js`;
// they hold no brand business logic of their own. The extract route streams
// `BrandExtractEvent`s as Server-Sent Events so the web `useBrandExtract` hook
// can render its 3-stage progress view.

import path from 'node:path';

import type { Application, Request, Response } from 'express';

import type { BrandExtractEvent } from '@open-design/contracts';

import type { insertProject } from './db.js';
import {
  extractBrand,
  listBrandSummaries,
  readBrandDetail,
  removeBrand,
  resolveBrandLogoPath,
  type ExtractBrandOptions,
} from './brands/index.js';

export interface BrandRoutesDeps {
  /** `<dataDir>/brands` — root of all brand directories. */
  brandsRoot: string;
  /** `<dataDir>/design-systems` — where extracted brands register their
   *  `user:<id>` design system, so selecting a brand in the composer reuses
   *  the existing design-system apply flow. */
  userDesignSystemsRoot: string;
  /** `<dataDir>/projects` — backing brand-generation projects. */
  projectsRoot?: string;
  /** Shared app database used to register the backing project. */
  db?: Parameters<typeof insertProject>[0];
  /** Optional id factory; defaults inside the brand engine when omitted. */
  randomId?: () => string;
}

/** Content-Type for the served primary logo, keyed by file extension. */
const LOGO_CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

export function registerBrandRoutes(app: Application, deps: BrandRoutesDeps): void {
  const { brandsRoot, userDesignSystemsRoot, projectsRoot, db, randomId } = deps;

  // GET /api/brands — list every stored brand as a summary.
  app.get('/api/brands', (_req: Request, res: Response) => {
    try {
      res.json({ brands: listBrandSummaries(brandsRoot) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/brands { url } — extract a brand, streaming progress as SSE.
  app.post('/api/brands', async (req: Request, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!url.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);

    const send = (e: BrandExtractEvent) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`);
    };

    try {
      const extractOptions: ExtractBrandOptions = {
        url,
        brandsRoot,
        userDesignSystemsRoot,
        onEvent: send,
        signal: controller.signal,
      };
      if (projectsRoot) extractOptions.projectsRoot = projectsRoot;
      if (db) extractOptions.db = db;
      if (randomId) extractOptions.randomId = randomId;
      await extractBrand(extractOptions);
    } catch (err) {
      // extractBrand is contracted never to throw, but guard anyway so a
      // surprise rejection still reaches the client as an error frame.
      send({ event: 'error', message: String(err) });
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  });

  // GET /api/brands/:id — full detail (meta + brand + guide). 404 if missing.
  app.get('/api/brands/:id', (req: Request, res: Response) => {
    try {
      const detail = readBrandDetail(brandsRoot, String(req.params.id));
      if (!detail) {
        res.status(404).json({ error: 'brand not found' });
        return;
      }
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/brands/:id — remove the brand and its registered design system.
  app.delete('/api/brands/:id', async (req: Request, res: Response) => {
    try {
      await removeBrand(brandsRoot, userDesignSystemsRoot, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/brands/:id/logo — serve the primary logo image. 404 if none.
  app.get('/api/brands/:id/logo', (req: Request, res: Response) => {
    try {
      const logoPath = resolveBrandLogoPath(brandsRoot, String(req.params.id));
      if (!logoPath) {
        res.status(404).json({ error: 'logo not found' });
        return;
      }
      const contentType = LOGO_CONTENT_TYPES[path.extname(logoPath).toLowerCase()];
      if (contentType) res.type(contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(logoPath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ error: 'logo not found' });
        }
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
