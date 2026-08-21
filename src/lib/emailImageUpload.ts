const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// The browser must accept a normal camera export before it can optimise it.
// Keep this below nginx's 12 MB request cap, then reduce the rendered image
// before it reaches the server.
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 3 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 1600;
const MAX_RENDER_PIXELS = 2_000_000;

const extensionForType = (type: string) => type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';

/** Convert common Google Drive share links into an image URL accepted by <img>. */
export function normalizeEmailImageUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const isDrive = /(^|\.)drive\.google\.com$/i.test(url.hostname) || /(^|\.)docs\.google\.com$/i.test(url.hostname);
    if (!isDrive) return raw;
    const pathId = url.pathname.match(/\/file\/d\/([^/?#]+)/)?.[1];
    const queryId = url.searchParams.get('id');
    const id = pathId || queryId;
    return id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : raw;
  } catch {
    return raw;
  }
}

function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    const token = raw ? JSON.parse(raw)?.token : '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function resizedName(file: File, type: string) {
  const baseName = file.name.replace(/\.[^.]+$/, '').trim() || 'email-image';
  return `${baseName}.${extensionForType(type)}`;
}

async function loadImage(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { image, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Accept ordinary camera exports, then keep the stored email image small in
 * both bytes and decoded pixels. The source-file cap only protects the browser
 * and proxy; it is not the final image-size limit shown to the user.
 */
export async function prepareEmailImage(file: File): Promise<File> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc GIF.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Ảnh gốc vượt quá 10MB. Hãy chọn ảnh nhỏ hơn hoặc dùng liên kết ảnh.');
  // Resizing animated GIFs would flatten animation, so keep them intact.
  if (file.type === 'image/gif') return file;

  const { image, url } = await loadImage(file);
  try {
    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;
    if (!originalWidth || !originalHeight) throw new Error('Không thể đọc kích thước ảnh.');
    const scale = Math.min(
      1,
      MAX_RENDER_DIMENSION / Math.max(originalWidth, originalHeight),
      Math.sqrt(MAX_RENDER_PIXELS / (originalWidth * originalHeight)),
    );
    if (scale >= 0.999 && file.size <= MAX_STORED_BYTES) return file;

    // WebP retains transparency for PNG artwork and can shrink a camera PNG
    // dramatically. JPEG photos stay JPEG for broad email-client support.
    const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    let width = Math.max(1, Math.round(originalWidth * scale));
    let height = Math.max(1, Math.round(originalHeight * scale));
    let blob: Blob | null = null;

    // If a detailed image is still large after its first resize, progressively
    // reduce quality and dimensions rather than rejecting it at the old 3 MB gate.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: outputType !== 'image/jpeg' });
      if (!context) return file;
      context.drawImage(image, 0, 0, width, height);
      const quality = Math.max(0.58, 0.88 - attempt * 0.1);
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputType, quality));
      if (blob && blob.size <= MAX_STORED_BYTES) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
    if (!blob) throw new Error('Không thể tối ưu ảnh này. Hãy thử ảnh khác hoặc dùng liên kết ảnh.');
    if (blob.size > MAX_STORED_BYTES) throw new Error('Không thể nén ảnh xuống mức phù hợp cho email. Hãy dùng liên kết ảnh hoặc chọn ảnh nhỏ hơn.');
    const preparedType = SUPPORTED_IMAGE_TYPES.has(blob.type) ? blob.type : outputType;
    return new File([blob], resizedName(file, preparedType), { type: preparedType });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadEmailImage(file: File): Promise<string> {
  const prepared = await prepareEmailImage(file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': prepared.type, 'X-File-Name': encodeURIComponent(prepared.name), ...authHeader() },
    body: prepared,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success || !payload.url) {
    throw new Error(payload.error || 'Không thể tải ảnh lên máy chủ. Ảnh chưa được chèn vào mẫu.');
  }
  return `${window.location.origin}${payload.url}`;
}
