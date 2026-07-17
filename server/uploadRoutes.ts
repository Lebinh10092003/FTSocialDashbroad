import { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const uploadRouter = Router();

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_UPLOADS_PER_WINDOW = 20;
const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

interface UploadWindow {
  count: number;
  resetAt: number;
}

interface ParsedUpload {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

const uploadWindows = new Map<string, UploadWindow>();

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
  }

  if (mimeType === 'image/gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }

  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }

  return false;
}

function decodeFilenameHeader(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue) return 'image';
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function parseLegacyBase64Upload(req: Request): ParsedUpload | null {
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const dataUrl = typeof req.body?.base64 === 'string' ? req.body.base64 : '';
  if (!filename || !dataUrl) return null;

  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;

  return {
    filename,
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
  };
}

function parseUpload(req: Request): ParsedUpload | null {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (Buffer.isBuffer(req.body) && ALLOWED_IMAGE_TYPES.has(contentType)) {
    return {
      filename: decodeFilenameHeader(req.headers['x-file-name']),
      mimeType: contentType,
      buffer: req.body,
    };
  }

  return parseLegacyBase64Upload(req);
}

function allowUpload(req: Request, res: Response): boolean {
  const now = Date.now();
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  const currentWindow = uploadWindows.get(clientKey);

  if (!currentWindow || currentWindow.resetAt <= now) {
    uploadWindows.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (currentWindow.count >= MAX_UPLOADS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((currentWindow.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      error: `Bạn đang tải ảnh quá nhanh. Vui lòng thử lại sau ${retryAfterSeconds} giây.`,
    });
    return false;
  } else {
    currentWindow.count += 1;
  }

  if (uploadWindows.size > 1000) {
    for (const [key, window] of uploadWindows.entries()) {
      if (window.resetAt <= now) uploadWindows.delete(key);
    }
  }

  return true;
}

uploadRouter.post('/', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!allowUpload(req, res)) return;

  try {
    const upload = parseUpload(req);
    if (!upload) {
      return res.status(400).json({
        success: false,
        error: 'Dữ liệu ảnh không hợp lệ. Chỉ hỗ trợ JPG, PNG, GIF và WEBP.',
      });
    }

    const extension = ALLOWED_IMAGE_TYPES.get(upload.mimeType);
    if (!extension) {
      return res.status(415).json({ success: false, error: 'Định dạng ảnh không được hỗ trợ.' });
    }

    if (upload.buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Tệp ảnh rỗng hoặc bị lỗi.' });
    }

    if (upload.buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ success: false, error: 'Ảnh vượt quá dung lượng tối đa 3MB.' });
    }

    if (!hasValidImageSignature(upload.buffer, upload.mimeType)) {
      return res.status(400).json({
        success: false,
        error: 'Nội dung tệp không khớp với định dạng ảnh.',
      });
    }

    const originalBaseName = path.basename(upload.filename, path.extname(upload.filename));
    const safeBaseName = originalBaseName
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'image';

    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const uniqueFilename = `${safeBaseName}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
    await fs.writeFile(path.join(uploadsDir, uniqueFilename), upload.buffer, { flag: 'wx' });

    return res.status(201).json({
      success: true,
      url: `/uploads/${uniqueFilename}`,
      mimeType: upload.mimeType,
      sizeBytes: upload.buffer.length,
    });
  } catch (error) {
    console.error('[Upload] Lỗi tải ảnh:', error);
    return res.status(500).json({
      success: false,
      error: 'Máy chủ không thể lưu ảnh. Vui lòng thử lại.',
    });
  }
});

export const uploadErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'Ảnh vượt quá dung lượng tối đa 3MB.' });
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ success: false, error: 'Dữ liệu gửi lên không đúng định dạng.' });
    return;
  }

  next(error);
};
