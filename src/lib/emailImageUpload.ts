const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 1600;
const MAX_RENDER_PIXELS = 2_000_000;

const extensionForType = (type: string) => type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';

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
 * Keep an email image small in both bytes and decoded pixels. A 3MB PNG may
 * still expand to dozens of MB in the browser, which is why byte-only limits
 * did not prevent the editor from stalling.
 */
export async function prepareEmailImage(file: File): Promise<File> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc GIF.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Ảnh vượt quá 3MB. Hãy chọn ảnh nhỏ hơn.');
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
    if (scale >= 0.999) return file;

    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg' });
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png';
    const quality = outputType === 'image/jpeg' || outputType === 'image/webp' ? 0.88 : undefined;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputType, quality));
    return blob ? new File([blob], resizedName(file, outputType), { type: outputType }) : file;
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
