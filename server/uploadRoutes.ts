import { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const uploadRouter = Router();

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature);
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

uploadRouter.post('/', async (req: Request, res: Response) => {
  try {
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
    const dataUrl = typeof req.body?.base64 === 'string' ? req.body.base64 : '';

    if (!filename || !dataUrl) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu tên tệp hoặc dữ liệu ảnh.',
      });
    }

    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match) {
      return res.status(400).json({
        success: false,
        error: 'Dữ liệu ảnh không hợp lệ. Chỉ hỗ trợ JPG, PNG, GIF và WEBP.',
      });
    }

    const mimeType = match[1].toLowerCase();
    const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
    if (!extension) {
      return res.status(415).json({
        success: false,
        error: 'Định dạng ảnh không được hỗ trợ.',
      });
    }

    const encodedPayload = match[2].replace(/\s/g, '');
    const buffer = Buffer.from(encodedPayload, 'base64');

    if (buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Tệp ảnh rỗng hoặc bị lỗi.',
      });
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({
        success: false,
        error: 'Ảnh vượt quá dung lượng tối đa 3MB.',
      });
    }

    if (!hasValidImageSignature(buffer, mimeType)) {
      return res.status(400).json({
        success: false,
        error: 'Nội dung tệp không khớp với định dạng ảnh.',
      });
    }

    const originalBaseName = path.basename(filename, path.extname(filename));
    const safeBaseName = originalBaseName
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'image';

    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const uniqueFilename = `${safeBaseName}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
    await fs.writeFile(path.join(uploadsDir, uniqueFilename), buffer, { flag: 'wx' });

    return res.status(201).json({
      success: true,
      url: `/uploads/${uniqueFilename}`,
      mimeType,
      sizeBytes: buffer.length,
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
    res.status(413).json({
      success: false,
      error: 'Ảnh vượt quá dung lượng tối đa 3MB.',
    });
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({
      success: false,
      error: 'Dữ liệu gửi lên không đúng định dạng JSON.',
    });
    return;
  }

  next(error);
};
