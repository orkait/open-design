import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerBrandRoutes } from '../src/brand-routes.js';
import { closeDatabase, insertProject, openDatabase } from '../src/db.js';

describe('brand routes', () => {
  let tempDir: string;
  let brandsRoot: string;
  let projectsRoot: string;
  let userDesignSystemsRoot: string;
  let skillsRoot: string;
  let dataDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-brand-routes-'));
    dataDir = path.join(tempDir, '.od');
    brandsRoot = path.join(dataDir, 'brands');
    projectsRoot = path.join(dataDir, 'projects');
    userDesignSystemsRoot = path.join(dataDir, 'design-systems');
    skillsRoot = path.join(tempDir, 'skills');
    mkdirSync(brandsRoot, { recursive: true });
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(userDesignSystemsRoot, { recursive: true });
    mkdirSync(skillsRoot, { recursive: true });
    db = openDatabase(projectsRoot, { dataDir });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves brand logos from a dot-prefixed data root', async () => {
    writeBrandFixture('brand-dot', {
      logoPrimary: 'logos/header.svg',
      logoBody: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
    });

    const response = await requestBrandLogo('brand-dot');

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('image/svg+xml');
    expect(response.body).toContain('<svg');
  });

  it('keeps logo 404 responses as JSON when no logo can be resolved', async () => {
    writeBrandFixture('brand-missing', { logoPrimary: 'logos/missing.svg' });

    const response = await requestBrandLogo('brand-missing');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('application/json');
    expect(JSON.parse(response.body)).toEqual({ error: 'logo not found' });
  });

  it('falls back to the backing project logo when the brand copy is missing', async () => {
    writeBrandFixture('brand-project', {
      projectId: 'project-brand',
      logoPrimary: 'logos/header.svg',
    });
    const logoDir = path.join(projectsRoot, 'project-brand', 'logos');
    mkdirSync(logoDir, { recursive: true });
    writeFileSync(
      path.join(logoDir, 'header.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>',
    );
    insertProject(db, {
      id: 'project-brand',
      name: 'Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-project' },
    });

    const response = await requestBrandLogo('brand-project');

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('image/svg+xml');
    expect(response.body).toContain('<circle');
  });

  function writeBrandFixture(
    id: string,
    options: { projectId?: string; logoPrimary: string; logoBody?: string },
  ) {
    const brandDir = path.join(brandsRoot, id);
    mkdirSync(brandDir, { recursive: true });
    writeFileSync(
      path.join(brandDir, 'meta.json'),
      JSON.stringify({
        id,
        sourceUrl: 'https://example.com',
        createdAt: 1,
        updatedAt: 1,
        status: 'ready',
        ...(options.projectId ? { projectId: options.projectId } : {}),
      }),
    );
    writeFileSync(
      path.join(brandDir, 'brand.json'),
      JSON.stringify({
        name: id,
        sourceUrl: 'https://example.com',
        logo: { primary: options.logoPrimary, alternates: [], notes: '' },
      }),
    );
    if (options.logoBody) {
      const logoPath = path.join(brandDir, options.logoPrimary);
      mkdirSync(path.dirname(logoPath), { recursive: true });
      writeFileSync(logoPath, options.logoBody);
    }
  }

  async function requestBrandLogo(id: string) {
    const app = express();
    registerBrandRoutes(app, {
      brandsRoot,
      userDesignSystemsRoot,
      projectsRoot,
      skillsRoot,
      dataDir,
      db,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/brands/${id}/logo`);
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
      };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
});
