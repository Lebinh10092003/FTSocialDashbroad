function isSameOriginOrLocalAsset(src: string) {
  if (!src || src.startsWith('data:')) return false;
  if (src.startsWith('blob:') || src.startsWith('/')) return true;
  try {
    const url = new URL(src, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function inlineClipboardImages(htmlContent: string) {
  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  const images = Array.from(container.querySelectorAll('img'));
  let embeddedCount = 0;

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src') || '';
    if (!isSameOriginOrLocalAsset(src)) return;

    try {
      const response = await fetch(src);
      if (!response.ok) return;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return;
      image.setAttribute('src', await blobToDataUrl(blob));
      embeddedCount += 1;
    } catch (error) {
      console.warn('Không thể nhúng ảnh vào clipboard:', src, error);
    }
  }));

  return {
    html: container.innerHTML,
    embeddedCount,
  };
}

/**
 * Copies rich HTML and plain text simultaneously to the clipboard.
 * Same-origin uploaded/blob images are converted to data URIs first so Gmail can
 * paste them like an inline screenshot instead of a broken localhost URL.
 */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string): Promise<boolean> {
  try {
    const prepared = await inlineClipboardImages(htmlContent);
    const normalizedHtml = prepared.html;

    if (navigator.clipboard && window.ClipboardItem) {
      // Modern Clipboard API
      const htmlBlob = new Blob([normalizedHtml], { type: 'text/html' });
      const textBlob = new Blob([plainTextContent], { type: 'text/plain' });
      
      const clipboardItem = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      });
      
      await navigator.clipboard.write([clipboardItem]);
      return true;
    } else {
      // Fallback: execCommand with clean node
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.left = '-9999px';
      div.style.top = '-9999px';
      // Put the HTML contents inside
      div.innerHTML = normalizedHtml;
      document.body.appendChild(div);
      
      const range = document.createRange();
      range.selectNode(div);
      
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        const successful = document.execCommand('copy');
        selection.removeAllRanges();
        document.body.removeChild(div);
        return successful;
      }
      
      document.body.removeChild(div);
      return false;
    }
  } catch (error) {
    console.error('Lỗi khi sao chép email:', error);
    
    // Last resort fallback: try plain text only
    try {
      const textarea = document.createElement('textarea');
      textarea.value = plainTextContent;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (fallbackError) {
      console.error('Lỗi khi chạy fallback copy plain text:', fallbackError);
      return false;
    }
  }
}

/**
 * Copies plain text (like Subject) to the clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch (error) {
    console.error('Lỗi khi sao chép text:', error);
    return false;
  }
}
