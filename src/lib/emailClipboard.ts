/**
 * Copies rich HTML and plain text simultaneously to the clipboard.
 * Highly optimized for Gmail compatibility when pasted.
 */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      // Modern Clipboard API
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
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
      div.innerHTML = htmlContent;
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
