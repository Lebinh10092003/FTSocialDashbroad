import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { LocalDb } from './localDb';

let projectId: string | undefined;
let databaseId: string | undefined;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = config.projectId;
    databaseId = config.firestoreDatabaseId;
  }
} catch (e) {
  console.error('Không thể đọc file cấu hình firebase-applet-config.json:', e);
}

const app = getApps().length === 0 
  ? initializeApp({ projectId: projectId || process.env.GOOGLE_CLOUD_PROJECT }) 
  : getApp();

export const adminAuth = getAuth(app);

// Thừa kế cơ sở dữ liệu gốc để gọi khi có kết nối
const rawFirestore = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

class WrappedDocRef {
  constructor(private colName: string, private docId: string) {}

  public get id() {
    return this.docId;
  }

  public async get(): Promise<any> {
    try {
      const snap = await rawFirestore.collection(this.colName).doc(this.docId).get();
      if (snap.exists) {
        const data = snap.data();
        if (data) {
          // Lưu cache vào LocalDb khi tải thành công từ Firestore
          LocalDb.setDoc(this.colName, this.docId, data);
        }
        return {
          exists: true,
          id: this.docId,
          data: () => data
        };
      }
    } catch (err: any) {
      console.warn(`[DualDb] Đọc tài liệu '${this.colName}/${this.docId}' từ Firestore thất bại (sẽ fallback sang LocalDb):`, err.message);
    }

    // Fallback sang LocalDb nội bộ
    const localData = LocalDb.getDoc(this.colName, this.docId);
    return {
      exists: !!localData,
      id: this.docId,
      data: () => localData || undefined
    };
  }

  public async set(data: any, options?: any): Promise<any> {
    const merge = options && options.merge;
    
    // Luôn ghi xuống LocalDb trước để không bị mất dữ liệu
    LocalDb.setDoc(this.colName, this.docId, data, merge);

    // Thử đồng bộ sang Firestore
    try {
      await rawFirestore.collection(this.colName).doc(this.docId).set(data, options);
    } catch (err: any) {
      console.warn(`[DualDb] Ghi tài liệu '${this.colName}/${this.docId}' lên Firestore thất bại:`, err.message);
    }
    return { writeTime: new Date() };
  }

  public async update(data: any): Promise<any> {
    // Luôn ghi xuống LocalDb trước
    LocalDb.updateDoc(this.colName, this.docId, data);

    // Thử đồng bộ sang Firestore
    try {
      await rawFirestore.collection(this.colName).doc(this.docId).update(data);
    } catch (err: any) {
      console.warn(`[DualDb] Cập nhật tài liệu '${this.colName}/${this.docId}' lên Firestore thất bại:`, err.message);
    }
    return { writeTime: new Date() };
  }

  public async delete(): Promise<any> {
    // Luôn xóa LocalDb trước
    LocalDb.deleteDoc(this.colName, this.docId);

    // Thử đồng bộ sang Firestore
    try {
      await rawFirestore.collection(this.colName).doc(this.docId).delete();
    } catch (err: any) {
      console.warn(`[DualDb] Xóa tài liệu '${this.colName}/${this.docId}' trên Firestore thất bại:`, err.message);
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

  public async get(): Promise<any> {
    try {
      let q: any = rawFirestore.collection(this.colName);
      for (const f of this.filters) {
        q = q.where(f.field, f.op, f.val);
      }
      if (this.orderField) {
        q = q.orderBy(this.orderField, this.orderDir);
      }
      if (this.limitCount !== null) {
        q = q.limit(this.limitCount);
      }

      const snap = await q.get();
      const docs = snap.docs.map((doc: any) => {
        const d = doc.data();
        // Cập nhật bộ nhớ cache cục bộ
        LocalDb.setDoc(this.colName, doc.id, d);
        return {
          id: doc.id,
          data: () => d
        };
      });

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length
      };
    } catch (err: any) {
      console.warn(`[DualDb] Truy vấn collection '${this.colName}' từ Firestore thất bại (sẽ fallback sang LocalDb):`, err.message);
    }

    // Fallback sang LocalDb
    let items = LocalDb.getList(this.colName);

    // Áp dụng bộ lọc where
    for (const f of this.filters) {
      items = items.filter(item => {
        const val = item[f.field];
        if (f.op === '==') return val === f.val;
        if (f.op === '!=') return val !== f.val;
        if (f.op === '>') return val > f.val;
        if (f.op === '>=') return val >= f.val;
        if (f.op === '<') return val < f.val;
        if (f.op === '<=') return val <= f.val;
        return true;
      });
    }

    // Áp dụng sắp xếp orderBy
    if (this.orderField) {
      const f = this.orderField;
      const d = this.orderDir === 'asc' ? 1 : -1;
      items.sort((a, b) => {
        const valA = a[f];
        const valB = b[f];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (valA < valB) return -1 * d;
        if (valA > valB) return 1 * d;
        return 0;
      });
    }

    // Áp dụng giới hạn limit
    if (this.limitCount !== null) {
      items = items.slice(0, this.limitCount);
    }

    const docs = items.map(item => {
      const id = item._localDocId || item.id || item.pageId || item.postKey || item.snapshotKey || item.logId || item.email || 'main';
      const cleanedItem = { ...item };
      delete cleanedItem._localDocId;
      return {
        id,
        data: () => cleanedItem
      };
    });

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }
}

class WrappedBatch {
  private operations: Array<{ docRef: WrappedDocRef; data: any; options?: any }> = [];

  public set(docRef: WrappedDocRef, data: any, options?: any) {
    this.operations.push({ docRef, data, options });
  }

  public async commit(): Promise<void> {
    for (const op of this.operations) {
      await op.docRef.set(op.data, op.options);
    }
  }
}

class WrappedFirestore {
  public collection(name: string) {
    return {
      doc: (id?: string) => {
        const finalId = id || 'main';
        return new WrappedDocRef(name, finalId);
      },
      get: () => {
        return new WrappedQuery(name).get();
      },
      where: (field: string, op: string, val: any) => {
        return new WrappedQuery(name).where(field, op, val);
      },
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
        return new WrappedQuery(name).orderBy(field, dir);
      },
      limit: (n: number) => {
        return new WrappedQuery(name).limit(n);
      }
    };
  }

  public batch() {
    return new WrappedBatch();
  }
}

export const adminDb = new WrappedFirestore() as any;
export default app;
