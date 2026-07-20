import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

// Đảm bảo tồn tại thư mục data
const dataDir = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new sqlite3.Database(dbPath);

// Khởi tạo bảng dữ liệu SQLite
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS collections (
      collection_name TEXT,
      doc_id TEXT,
      data TEXT,
      PRIMARY KEY (collection_name, doc_id)
    )
  `);
  console.log('[SQLite] Đã kết nối cơ sở dữ liệu SQLite tại server/data/app.db');
});

// Helper thực thi query SQLite bất đồng bộ
const dbRun = (sql: string, params: any[] = []) => 
  new Promise<any>((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const dbGet = (sql: string, params: any[] = []) => 
  new Promise<any>((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbAll = (sql: string, params: any[] = []) => 
  new Promise<any[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

// Mock Firebase Admin Auth interface sử dụng JWT decode và bộ lưu trữ local
export const adminAuth = {
  verifyIdToken: async (idToken: string): Promise<any> => {
    if (idToken.startsWith('mock-dev-token-')) {
      const email = idToken.replace('mock-dev-token-', '');
      return {
        uid: 'mock-uid-' + email,
        email,
        name: email.split('@')[0],
        displayName: email.split('@')[0]
      };
    }
    
    // Tự động giải mã Firebase JWT token gửi từ client mà không cần gọi Firebase API
    const parts = idToken.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        return {
          uid: payload.user_id || payload.sub || ('mock-uid-' + payload.email),
          email: payload.email,
          name: payload.name || payload.email,
          displayName: payload.name || payload.email
        };
      } catch (err: any) {
        throw new Error('Lỗi giải mã token JWT: ' + err.message);
      }
    }
    throw new Error('Định dạng token không hợp lệ.');
  },

  getUserByEmail: async (email: string): Promise<any> => {
    return {
      uid: 'mock-uid-' + email,
      email: email,
      displayName: email.split('@')[0]
    };
  },

  createUser: async (properties: any): Promise<any> => {
    return {
      uid: 'mock-uid-' + properties.email,
      email: properties.email,
      displayName: properties.displayName
    };
  },

  updateUser: async (uid: string, properties: any): Promise<any> => {
    return { uid };
  },

  deleteUser: async (uid: string): Promise<any> => {
    return { uid };
  }
};

// Wrapper classes để map API SQLite giống hệt Firestore SDK (không cần đổi code ở client/server routes)
type DatabaseRecord = Record<string, any>;

interface WrappedDocumentSnapshot {
  exists: boolean;
  id: string;
  data: () => DatabaseRecord | undefined;
}

interface WrappedQueryDocumentSnapshot {
  id: string;
  data: () => DatabaseRecord;
}

interface WrappedQuerySnapshot {
  docs: WrappedQueryDocumentSnapshot[];
  empty: boolean;
  size: number;
}

class WrappedDocRef {
  constructor(private colName: string, private docId: string) {}

  public get id() {
    return this.docId;
  }

  public async get(): Promise<WrappedDocumentSnapshot> {
    try {
      const row = await dbGet(
        'SELECT data FROM collections WHERE collection_name = ? AND doc_id = ?', 
        [this.colName, this.docId]
      );
      if (row && row.data) {
        const data = JSON.parse(row.data);
        return {
          exists: true,
          id: this.docId,
          data: () => data
        };
      }
    } catch (err: any) {
      console.warn(`[SQLite] Đọc tài liệu '${this.colName}/${this.docId}' thất bại:`, err.message);
    }

    return {
      exists: false,
      id: this.docId,
      data: () => undefined
    };
  }

  public async set(data: any, options?: any): Promise<any> {
    const merge = options && options.merge;
    let finalData = data;

    if (merge) {
      const existing = await this.get();
      if (existing.exists) {
        finalData = { ...existing.data(), ...data };
      }
    }

    try {
      await dbRun(
        'INSERT OR REPLACE INTO collections (collection_name, doc_id, data) VALUES (?, ?, ?)',
        [this.colName, this.docId, JSON.stringify(finalData)]
      );
    } catch (err: any) {
      console.error(`[SQLite] Ghi tài liệu '${this.colName}/${this.docId}' thất bại:`, err.message);
    }

    return { writeTime: new Date() };
  }

  public async update(data: any): Promise<any> {
    const existing = await this.get();
    let finalData = data;
    if (existing.exists) {
      finalData = { ...(existing.data() || {}), ...data };
    }
    try {
      await dbRun(
        'INSERT OR REPLACE INTO collections (collection_name, doc_id, data) VALUES (?, ?, ?)',
        [this.colName, this.docId, JSON.stringify(finalData)]
      );
    } catch (err: any) {
      console.error(`[SQLite] Cập nhật tài liệu '${this.colName}/${this.docId}' thất bại:`, err.message);
    }
    return { writeTime: new Date() };
  }

  public async delete(): Promise<any> {
    try {
      await dbRun(
        'DELETE FROM collections WHERE collection_name = ? AND doc_id = ?',
        [this.colName, this.docId]
      );
    } catch (err: any) {
      console.error(`[SQLite] Xóa tài liệu '${this.colName}/${this.docId}' thất bại:`, err.message);
    }
    return { writeTime: new Date() };
  }
}

class WrappedQuery {
  private filters: Array<{ field: string; op: string; val: any }> = [];
  private orderField: string | null = null;
  private orderDir: 'asc' | 'desc' = 'asc';
  private limitCount: number | null = null;

  constructor(private colName: string) {}

  public doc(id?: string): WrappedDocRef {
    return new WrappedDocRef(this.colName, id || 'main');
  }

  public where(field: string, op: string, val: any): WrappedQuery {
    this.filters.push({ field, op, val });
    return this;
  }

  public orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): WrappedQuery {
    this.orderField = field;
    this.orderDir = dir;
    return this;
  }

  public limit(n: number): WrappedQuery {
    this.limitCount = n;
    return this;
  }

  public startAfter(value: any): WrappedQuery {
    // Không dùng phân trang nâng cao trong mock/sqlite
    return this;
  }

  public async get(): Promise<WrappedQuerySnapshot> {
    try {
      const rows = await dbAll(
        'SELECT doc_id, data FROM collections WHERE collection_name = ?',
        [this.colName]
      );

      let items = rows.map(r => {
        const parsed = JSON.parse(r.data);
        return {
          _sqliteDocId: r.doc_id,
          ...parsed
        };
      });

      // Áp dụng filters ở tầng JS để tương thích hoàn toàn với schema-less fields
      for (const f of this.filters) {
        items = items.filter(item => {
          const val = item[f.field];
          if (f.op === '==' || f.op === 'is-equal') return val === f.val;
          if (f.op === '!=') return val !== f.val;
          if (f.op === '>') return val > f.val;
          if (f.op === '>=') return val >= f.val;
          if (f.op === '<') return val < f.val;
          if (f.op === '<=') return val <= f.val;
          if (f.op === 'array-contains') return Array.isArray(val) && val.includes(f.val);
          return true;
        });
      }

      // Áp dụng sắp xếp
      if (this.orderField) {
        const field = this.orderField;
        const dirMultiplier = this.orderDir === 'asc' ? 1 : -1;
        items.sort((a, b) => {
          const valA = a[field];
          const valB = b[field];
          if (valA === undefined || valA === null) return 1;
          if (valB === undefined || valB === null) return -1;
          if (valA < valB) return -1 * dirMultiplier;
          if (valA > valB) return 1 * dirMultiplier;
          return 0;
        });
      }

      // Áp dụng giới hạn limit
      if (this.limitCount !== null) {
        items = items.slice(0, this.limitCount);
      }

      const docs = items.map(item => {
        const id = item._sqliteDocId;
        const cleaned = { ...item };
        delete cleaned._sqliteDocId;
        return {
          id,
          data: () => cleaned
        };
      });

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length
      };

    } catch (err: any) {
      console.warn(`[SQLite] Truy vấn collection '${this.colName}' thất bại:`, err.message);
      return { docs: [], empty: true, size: 0 };
    }
  }
}

class WrappedBatch {
  private operations: Array<{ docRef: WrappedDocRef; type: 'set' | 'delete'; data?: any; options?: any }> = [];

  public set(docRef: WrappedDocRef, data: any, options?: any) {
    this.operations.push({ docRef, type: 'set', data, options });
  }

  public delete(docRef: WrappedDocRef) {
    this.operations.push({ docRef, type: 'delete' });
  }

  public async commit(): Promise<void> {
    try {
      await dbRun('BEGIN TRANSACTION');
      for (const op of this.operations) {
        if (op.type === 'set') {
          await op.docRef.set(op.data, op.options);
        } else if (op.type === 'delete') {
          await op.docRef.delete();
        }
      }
      await dbRun('COMMIT');
    } catch (err) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        // Ignored
      }
      throw err;
    }
  }
}

class WrappedFirestore {
  public collection(name: string): WrappedQuery {
    return new WrappedQuery(name);
  }

  public batch() {
    return new WrappedBatch();
  }
}

export const adminDb = new WrappedFirestore();
const mockApp = {} as any;
export default mockApp;
