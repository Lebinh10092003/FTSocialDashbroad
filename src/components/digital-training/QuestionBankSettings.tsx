import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Link2, Loader2, RefreshCw, Save } from "lucide-react";

type QuestionBankSettings = { default_url: string };
type BankQuestion = { audience_group?: string; category?: string; knowledge_type?: string; difficulty?: string };
type BankPreview = { bank_questions?: BankQuestion[]; source_name?: string; errors?: string[]; warnings?: string[] };
type BankSummaryRow = { group: string; category: string; total: number; theory: number; practice: number; easy: number; medium: number; hard: number };

const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return String(body.error);
  const first = Object.values(body)[0];
  return Array.isArray(first) ? first.join(" ") : String(first || "Không thể xử lý yêu cầu.");
};

const normalized = (value: unknown) => String(value || "").trim().toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

export default function QuestionBankSettings({ idToken }: { idToken: string }) {
  const [settings, setSettings] = useState<QuestionBankSettings>({ default_url: "" });
  const [busy, setBusy] = useState(true);
  const [readingBank, setReadingBank] = useState(false);
  const [notice, setNotice] = useState("");
  const [bankError, setBankError] = useState("");
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankSource, setBankSource] = useState("");
  const [readAt, setReadAt] = useState("");
  const auth = { Authorization: `Bearer ${idToken}` };

  const summaryRows = useMemo(() => {
    const rows = new Map<string, BankSummaryRow>();
    bankQuestions.forEach((question) => {
      const group = String(question.audience_group || "Chưa phân nhóm").trim() || "Chưa phân nhóm";
      const category = String(question.category || "Chưa phân chủ đề").trim() || "Chưa phân chủ đề";
      const key = `${group}\u0000${category}`;
      const row = rows.get(key) || { group, category, total: 0, theory: 0, practice: 0, easy: 0, medium: 0, hard: 0 };
      row.total += 1;
      const knowledge = normalized(question.knowledge_type);
      const difficulty = normalized(question.difficulty);
      if (["ly thuyet", "theory"].includes(knowledge)) row.theory += 1;
      if (["thuc hanh", "practice"].includes(knowledge)) row.practice += 1;
      if (["de", "easy"].includes(difficulty)) row.easy += 1;
      if (["trung binh", "medium"].includes(difficulty)) row.medium += 1;
      if (["kho", "hard"].includes(difficulty)) row.hard += 1;
      rows.set(key, row);
    });
    return Array.from(rows.values()).sort((a, b) => a.group.localeCompare(b.group, "vi") || a.category.localeCompare(b.category, "vi"));
  }, [bankQuestions]);

  const readBank = async (url = settings.default_url) => {
    if (!url.trim()) { setBankError("Chưa có liên kết ngân hàng đề thi để đọc."); return; }
    setReadingBank(true);
    setBankError("");
    try {
      const response = await fetch("/api/digital-training/assessments/import-preview", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ google_sheet_url: url.trim(), import_mode: "prepared" }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const preview = await response.json() as BankPreview;
      if (preview.errors?.length) throw new Error(preview.errors[0]);
      setBankQuestions(preview.bank_questions || []);
      setBankSource(preview.source_name || url.trim());
      setReadAt(new Date().toLocaleString("vi-VN"));
    } catch (error: any) {
      setBankQuestions([]);
      setBankSource("");
      setBankError(String(error?.message || error));
    } finally {
      setReadingBank(false);
    }
  };

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-settings", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const next = await response.json() as QuestionBankSettings;
      setSettings(next);
      void readBank(next.default_url);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (idToken) void load(); }, [idToken]);

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-settings", {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ default_url: settings.default_url.trim() }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const next = await response.json() as QuestionBankSettings;
      setSettings(next);
      setNotice("Đã lưu ngân hàng đề thi mặc định.");
      void readBank(next.default_url);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  return <section className="space-y-5">
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Link2 className="h-6 w-6" /></span><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Cấu hình dùng chung</p><h2 className="mt-1 text-2xl font-extrabold text-[#001e40]">Set up ngân hàng đề thi</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Gắn liên kết ngân hàng đề thi mặc định. Mỗi lần tạo đề, hệ thống sẽ đọc lại nguồn này để dùng dữ liệu mới nhất.</p></div></div>
      <label className="mt-6 block"><span className="mb-1 block text-sm font-bold">Liên kết Google Sheet / Google Drive</span><input type="url" className="ft-input" value={settings.default_url} onChange={(event) => setSettings({ default_url: event.target.value })} placeholder="https://docs.google.com/... hoặc https://drive.google.com/file/d/..." /></label>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={save} className="ft-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Lưu ngân hàng mặc định</button><button disabled={busy} onClick={() => void load()} className="ft-btn ft-btn-secondary disabled:opacity-50"><RefreshCw className="h-4 w-4" />Tải lại</button></div>
      {notice && <p className={`mt-4 rounded-xl p-3 text-sm ${notice.startsWith("Đã lưu") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{notice}</p>}
    </div>

    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-blue-100 p-3 text-blue-700"><FileSpreadsheet className="h-6 w-6" /></span><div><h2 className="text-lg font-extrabold text-[#001e40]">Mô tả ngân hàng đề thi hiện tại</h2><p className="mt-1 text-sm text-slate-500">{bankSource ? `${bankQuestions.length} câu · ${summaryRows.length} chủ đề` : "Đọc ngân hàng để xem dữ liệu hiện tại."}{readAt ? ` · cập nhật ${readAt}` : ""}</p></div></div><button disabled={readingBank || busy} onClick={() => void readBank()} className="ft-btn ft-btn-secondary disabled:opacity-50">{readingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Đọc lại ngân hàng</button></div>
      {readingBank ? <div className="grid min-h-52 place-items-center text-sm text-slate-500"><span className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin text-blue-600" />Đang đọc ngân hàng đề thi…</span></div> : bankError ? <p className="m-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{bankError}</p> : summaryRows.length ? <div className="overflow-x-auto"><table className="ft-table min-w-[920px]"><thead><tr><th>Nhóm đối tượng</th><th>Chủ đề</th><th>Tổng câu</th><th>Lý thuyết</th><th>Thực hành</th><th>Dễ</th><th>Trung bình</th><th>Khó</th></tr></thead><tbody>{summaryRows.map((row) => <tr key={`${row.group}-${row.category}`}><td><b>{row.group}</b></td><td>{row.category}</td><td className="font-bold">{row.total}</td><td>{row.theory}</td><td>{row.practice}</td><td>{row.easy}</td><td>{row.medium}</td><td>{row.hard}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">Chưa có dữ liệu ngân hàng để mô tả.</div>}
    </section>
  </section>;
}