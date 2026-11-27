import * as path from 'node:path';
import type { Response } from 'express';
import { UploadsFallbackController } from './uploads-fallback.controller';

function response(error?: Error) {
  const res = {
    headersSent: false,
    setHeader: jest.fn(),
    sendFile: jest.fn((_file: string, _options: { root: string; dotfiles: string }, done: (error?: Error) => void) => done(error)),
    redirect: jest.fn(), status: jest.fn(), send: jest.fn(), end: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('UploadsFallbackController', () => {
  const previous = process.env.R2_PUBLIC_URL;
  afterEach(() => { if (previous === undefined) delete process.env.R2_PUBLIC_URL; else process.env.R2_PUBLIC_URL = previous; });

  it('serves a local image before the remote fallback with nosniff header', () => {
    process.env.R2_PUBLIC_URL = 'https://cdn.example.test/';
    const res = response();
    new UploadsFallbackController().handleUploadFallback('image.jpg', res as unknown as Response);
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.sendFile).toHaveBeenCalledWith('image.jpg', { root: path.resolve(process.cwd(), 'uploads'), dotfiles: 'deny' }, expect.any(Function));
    expect(res.redirect).not.toHaveBeenCalled(); expect(res.status).not.toHaveBeenCalled();
  });

  it('serves per-document image assets from uploads/documents/:noteId/assets', () => {
    const res = response();
    new UploadsFallbackController().handleDocumentAssetFallback('note123', 'img-abc.png', res as unknown as Response);
    expect(res.sendFile).toHaveBeenCalledWith(
      'img-abc.png',
      { root: path.resolve(process.cwd(), 'uploads/documents/note123/assets'), dotfiles: 'deny' },
      expect.any(Function),
    );
  });

  it('blocks unauthenticated public access to private document JSON payloads', () => {
    const res = response();
    new UploadsFallbackController().blockPrivateDocumentAccess(res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.sendFile).not.toHaveBeenCalled();

    const jsonAssetRes = response();
    new UploadsFallbackController().handleDocumentAssetFallback('note123', 'doc.json', jsonAssetRes as unknown as Response);
    expect(jsonAssetRes.status).toHaveBeenCalledWith(404);
    expect(jsonAssetRes.sendFile).not.toHaveBeenCalled();
  });

  it('sandboxes SVG assets with Content-Security-Policy', () => {
    const res = response();
    new UploadsFallbackController().handleUploadFallback('diagram.svg', res as unknown as Response);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', "default-src 'none'; sandbox");
  });

  it('redirects a missing local image to R2', () => {
    process.env.R2_PUBLIC_URL = 'https://cdn.example.test/';
    const res = response(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    new UploadsFallbackController().handleUploadFallback('missing image.jpg', res as unknown as Response);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://cdn.example.test/uploads/missing%20image.jpg');
  });

  it('returns 404 without R2', () => {
    delete process.env.R2_PUBLIC_URL;
    const res = response(Object.assign(new Error('missing'), { status: 404 }));
    new UploadsFallbackController().handleUploadFallback('missing.jpg', res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('does not redirect access errors or write after headers were sent', () => {
    process.env.R2_PUBLIC_URL = 'https://cdn.example.test';
    const res = response(Object.assign(new Error('denied'), { status: 403 }));
    new UploadsFallbackController().handleUploadFallback('private.jpg', res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(403); expect(res.redirect).not.toHaveBeenCalled();
    const sent = response(new Error('aborted')); sent.headersSent = true;
    new UploadsFallbackController().handleUploadFallback('image.jpg', sent as unknown as Response);
    expect(sent.status).not.toHaveBeenCalled();
  });

  it.each(['../image.jpg', '..', '.env', 'folder/image.jpg', 'folder\\image.jpg', 'secret.json'])('rejects unsafe filename %s', filename => {
    const res = response();
    new UploadsFallbackController().handleUploadFallback(filename, res as unknown as Response);
    expect(res.sendFile).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(404);
  });
});
