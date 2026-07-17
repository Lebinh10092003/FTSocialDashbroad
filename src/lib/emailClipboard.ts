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

/**
 * Copies rich HTML and plain text simultaneously to the clipboard.
 * Same-origin uploaded/blob images are converted to data URIs first.
 * Uses selection contents copying which is the gold standard for pasting into Gmail/Outlook.
 */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string): Promise<boolean> {
  try {
    // 1. Create a temporary hidden container in the DOM
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = '650px';
    tempDiv.style.overflow = 'hidden';
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);

    // 2. Inline local/blob images inside this DOM structure
    const images = Array.from(tempDiv.querySelectorAll('img'));
    await Promise.all(images.map(async (image) => {
      const src = image.getAttribute('src') || '';
      if (!isSameOriginOrLocalAsset(src)) return;

      try {
        const response = await fetch(src);
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return;
        const dataUrl = await blobToDataUrl(blob);
        image.setAttribute('src', dataUrl);
      } catch (error) {
        console.warn('Không thể nhúng ảnh vào clipboard:', src, error);
      }
    }));

    // 3. Perform selection and copy using the Selection API (the gold standard for rich HTML pasting)
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    
    const selection = window.getSelection();
    if (!selection) {
      document.body.removeChild(tempDiv);
      return false;
    }
    
    selection.removeAllRanges();
    selection.addRange(range);
    
    const successful = document.execCommand('copy');
    selection.removeAllRanges();
    
    if (successful) {
      document.body.removeChild(tempDiv);
      return true;
    }

    // 4. Fallback to Clipboard API if execCommand fails
    if (navigator.clipboard && window.ClipboardItem) {
      const htmlBlob = new Blob([tempDiv.innerHTML], { type: 'text/html' });
      const textBlob = new Blob([plainTextContent], { type: 'text/plain' });
      const clipboardItem = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      });
      await navigator.clipboard.write([clipboardItem]);
      document.body.removeChild(tempDiv);
      return true;
    }
    
    document.body.removeChild(tempDiv);
    return false;
  } catch (error) {
    console.error('Lỗi khi sao chép email:', error);
    return false;
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
