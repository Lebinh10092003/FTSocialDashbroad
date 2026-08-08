import React, { useEffect, useState } from "react";
import { Link2, Loader2, RefreshCw, Save } from "lucide-react";

type QuestionBankSettings = { default_url: string };

const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return String(body.error);
  const first = Object.values(body)[0];
  return Array.isArray(first) ? first.join(" ") : String(first || "Không thể xử lý yêu cầu.");
};

export default function QuestionBankSettings({ idToken }: { idToken: string }) {
  const [settings, setSettings] = useState<QuestionBankSettings>({ default_url: "" });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const auth = { Authorization: `Bearer ${idToken}` };

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-settings", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      setSettings(await response.json());
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
      setSettings(await response.json());
      setNotice("Đã lưu ngân hàng đề thi mặc định.");
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
  </section>;
}