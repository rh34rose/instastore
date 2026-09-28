import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { MAX_IMAGE_BYTES, type StoreDO } from '../../store';
import { flashFor, type AdminShell } from '../../views/admin/layout';

export type AdminCtx = Context<AppEnv>;

/** Loads what the admin chrome needs in one pipelined round-trip. */
export async function loadAdminShell(c: AdminCtx): Promise<AdminShell> {
  const store = c.get('store');
  const [settings, stats] = await Promise.all([store.getSettings(), store.getStats()]);
  return {
    settings,
    stats,
    adminEmail: c.get('adminEmail'),
    path: new URL(c.req.url).pathname,
    flash: flashFor(c.req.query('flash')),
    devBypass: c.get('adminDev'),
  };
}

export function redirectWithFlash(c: AdminCtx, path: string, flash: string): Response {
  return c.redirect(`${path}${path.includes('?') ? '&' : '?'}flash=${flash}`);
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type UploadResult = { ok: true; ids: string[] } | { ok: false; error: string; flash: 'image-too-large' | 'image-type' };

/** Validates uploaded files and stores them in the Durable Object. All-or-nothing. */
export async function storeUploads(store: DurableObjectStub<StoreDO>, files: File[]): Promise<UploadResult> {
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) {
      return { ok: false, error: `"${file.name}" is not a JPEG, PNG, WebP or GIF image.`, flash: 'image-type' };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: `"${file.name}" is too large (${Math.round(file.size / 1024)} KB). Keep photos under 1.5 MB.`, flash: 'image-too-large' };
    }
  }
  const ids = await Promise.all(files.map(async (file) => store.putImage(file.type, await file.arrayBuffer())));
  return { ok: true, ids };
}
