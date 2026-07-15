import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');

// Đảm bảo thư mục dữ liệu tồn tại
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class LocalDb {
  private static getFilePath(collectionName: string): string {
    return path.join(DATA_DIR, `${collectionName}.json`);
  }

  // Đọc toàn bộ collection từ file JSON
  public static readCollection(collectionName: string): Record<string, any> {
    const filePath = this.getFilePath(collectionName);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content || '{}');
    } catch (error) {
      console.error(`[LocalDb] Lỗi đọc dữ liệu collection ${collectionName}:`, error);
      return {};
    }
  }

  // Ghi toàn bộ dữ liệu vào file JSON
  public static writeCollection(collectionName: string, data: Record<string, any>): void {
    const filePath = this.getFilePath(collectionName);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`[LocalDb] Lỗi ghi dữ liệu collection ${collectionName}:`, error);
    }
  }

  // Đọc 1 document cụ thể
  public static getDoc(collectionName: string, docId: string): any | null {
    const col = this.readCollection(collectionName);
    return col[docId] || null;
  }

  // Lưu hoặc cập nhật 1 document
  public static setDoc(collectionName: string, docId: string, data: any, merge: boolean = false): void {
    const col = this.readCollection(collectionName);
    if (merge && col[docId]) {
      col[docId] = { ...col[docId], ...data };
    } else {
      col[docId] = data;
    }
    this.writeCollection(collectionName, col);
  }

  // Cập nhật từng trường trong document
  public static updateDoc(collectionName: string, docId: string, data: any): void {
    this.setDoc(collectionName, docId, data, true);
  }

  // Xóa 1 document
  public static deleteDoc(collectionName: string, docId: string): void {
    const col = this.readCollection(collectionName);
    if (col[docId]) {
      delete col[docId];
      this.writeCollection(collectionName, col);
    }
  }

  // Lấy tất cả documents dưới dạng danh sách
  public static getList(collectionName: string): any[] {
    const col = this.readCollection(collectionName);
    return Object.values(col);
  }
}
