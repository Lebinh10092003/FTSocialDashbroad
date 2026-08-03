import { EmailBlock, EmailTemplate } from '../types/emailBuilder';
import { renderEmailIconDataUri } from './emailIcon';

export const emailIconRasterKey = (name: string, color: string) => `${name}|${color.toLowerCase()}`;

const storedAuthHeader = (): Record<string, string> => {
  try {
    const session = JSON.parse(localStorage.getItem('ft_auth_session') || 'null');
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  } catch {
    return {};
  }
};

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [header, encoded] = dataUrl.split(',', 2);
  const mime = header.match(/^data:([^;]+)/i)?.[1] || 'image/png';
  const bytes = atob(encoded || '');
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mime });
};

async function rasterizeEmailIcon(name: string, color: string): Promise<string> {
  const renderSize = 128;
  const svgDataUrl = renderEmailIconDataUri(name, color, renderSize);
  if (!svgDataUrl) return '';
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Không thể dựng icon ${name}.`));
    image.src = svgDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = renderSize;
  canvas.height = renderSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không hỗ trợ chuyển icon sang PNG.');
  context.clearRect(0, 0, renderSize, renderSize);
  context.drawImage(image, 0, 0, renderSize, renderSize);
  return canvas.toDataURL('image/png');
}

async function publishEmailIcon(name: string, color: string): Promise<string> {
  const pngDataUrl = await rasterizeEmailIcon(name, color);
  if (!pngDataUrl) return '';
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-File-Name': encodeURIComponent(`email-icon-${name}.png`),
        ...storedAuthHeader(),
      },
      body: dataUrlToBlob(pngDataUrl),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.success && result.url) return new URL(result.url, window.location.origin).href;
  } catch {
    // A PNG data URI is still safer for clipboard delivery than the previous SVG data URI.
  }
  return pngDataUrl;
}

export async function prepareEmailIconsForDelivery(template: EmailTemplate): Promise<EmailTemplate> {
  const cache = new Map<string, Promise<string>>();
  let changed = false;

  const prepareBlocks = async (blocks: EmailBlock[]): Promise<EmailBlock[]> => Promise.all(blocks.map(async block => {
    let nextBlock = block;
    if (block.type === 'icon-text' && block.content.iconSource !== 'upload') {
      const name = block.content.iconName || 'CircleCheck';
      const color = block.content.iconColor || '#1473D1';
      const rasterKey = emailIconRasterKey(name, color);
      const hasCurrentPng = block.content.iconRasterKey === rasterKey && Boolean(block.content.iconPngUrl);
      if (!hasCurrentPng) {
        if (!cache.has(rasterKey)) cache.set(rasterKey, publishEmailIcon(name, color));
        const iconPngUrl = await cache.get(rasterKey)!;
        if (iconPngUrl) {
          changed = true;
          nextBlock = { ...nextBlock, content: { ...nextBlock.content, iconPngUrl, iconRasterKey: rasterKey } };
        }
      }
    }

    const children = nextBlock.children?.length ? await prepareBlocks(nextBlock.children) : nextBlock.children;
    const columns = nextBlock.columns?.length
      ? await Promise.all(nextBlock.columns.map(column => prepareBlocks(column)))
      : nextBlock.columns;
    if (children !== nextBlock.children || columns !== nextBlock.columns) nextBlock = { ...nextBlock, children, columns };
    return nextBlock;
  }));

  const blocks = await prepareBlocks(template.blocks);
  return changed ? { ...template, blocks, lastUpdated: Date.now() } : template;
}
