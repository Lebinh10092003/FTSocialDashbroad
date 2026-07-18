/**
 * Copies rich HTML and plain text simultaneously to the clipboard.
 * Uses synchronous selection copying to preserve user gesture trust, which is highly compatible
 * with rich-text pasting into Gmail/Outlook and supports embedded Base64 images without security blocks.
 */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string, emailWidth = 650): Promise<boolean> {
  try {
    // 1. Create a temporary hidden container in the DOM
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = `${emailWidth}px`;
    tempDiv.style.overflow = 'hidden';
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);

    // 2. Perform selection and copy using the Selection API (100% synchronous to preserve gesture trust)
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
    document.body.removeChild(tempDiv);
    
    if (successful) {
      return true;
    }

    // 3. Fallback to modern Clipboard API if execCommand is disabled
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([plainTextContent], { type: 'text/plain' });
        const clipboardItem = new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        });
        await navigator.clipboard.write([clipboardItem]);
        return true;
      }
    } catch (clipErr) {
      console.warn('Modern clipboard fallback failed, trying writeText:', clipErr);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainTextContent);
        return true;
      }
    }
    
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
