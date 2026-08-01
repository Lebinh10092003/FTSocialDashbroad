import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ClipboardCopy,
  Clock3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Layers3,
  Link2,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Shuffle,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import * as XLSX from "xlsx";

type Assessment = {
  id: number;
  title: string;
  session?: number | null;
  session_name?: string;
  partner_name?: string;
  training_class?: number | null;
  class_name?: string;
  description: string;
  instructions: string;
  duration_minutes: number;
  opens_at?: string | null;
  closes_at?: string | null;
  attempt_limit: number;
  status: "draft" | "published" | "closed";
  public_slug: string;
  questions: any[];
  variants: Array<{ name: string; question_count: number }>;
  source_type: string;
  source_name: string;
  attempts_count: number;
  submitted_count: number;
  average_score?: number | null;
  variant_distribution: Record<string, number>;
  generation_mode: "prepared" | "auto_generate";
  generation_config: Record<string, any>;
  question_bank_url?: string;
  output_sheet_url?: string;
  drive_folder_id?: string;
  audience_group?: string;
  participants?: any[];
  participant_count: number;
  max_people_per_variant: number;
  sync_status: string;
  sync_error?: string;
  sync_counts: { pending: number; synced: number; error: number };
  updated_at: string;
};

type Preview = {
  source_name: string;
  source_type: string;
  questions: any[];
  variants: Array<{ name: string; question_count: number }>;
  question_count: number;
  errors: string[];
  warnings: string[];
  import_mode: "prepared" | "auto_generate";
  source_question_count?: number;
  bank_questions?: any[];
  available_groups?: string[];
  source_url?: string;
  generation_config?: {
    variant_count: number;
    questions_per_variant: number;
    source_question_count: number;
    seed: number;
  };
};

const emptyDraft = () => ({
  title: "",
  target: "",
  duration_minutes: "30",
  attempt_limit: "1",
  opens_at: "",
  closes_at: "",
  description: "",
  instructions: "Không tải lại trang hoặc thoát trình duyệt trong khi làm bài. Bài sẽ tự nộp khi hết giờ.",
  status: "draft",
  audience_group: "",
  output_sheet_url: "",
  drive_folder_id: "",
  participants_text: "",
});

const parseParticipants = (source: string) => source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    return { code: cells[0] || `P-${String(index + 1).padStart(3, "0")}`, name: cells[1] || "", email: cells[2] || "", phone: cells[3] || "", organization: cells[4] || "", group: cells[5] || "" };
  })
  .filter((item, index) => index > 0 || !/^(ma|code)/i.test(item.code));

const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return body.error;
  const first = Object.values(body)[0];
  return Array.isArray(first) ? first.join(" ") : String(first || "Không thể xử lý yêu cầu.");
};

const statusLabel: Record<string, string> = {
  draft: "Bản nháp",
  published: "Đang mở",
  closed: "Đã đóng",
};

export default function TrainingAssessmentsAdmin({
  idToken,
  sessions,
  classes,
  isGuest,
}: {
  idToken: string;
  sessions: any[];
  classes: any[];
  isGuest: boolean;
}) {
  const [items, setItems] = useState<Assessment[]>([]);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [manualScores, setManualScores] = useState<Record<number, string>>({});
  const [screen, setScreen] = useState<"list" | "create" | "detail" | "bank">("list");
  const [draft, setDraft] = useState(emptyDraft);
  const [importMode, setImportMode] = useState<"prepared" | "auto_generate">("prepared");
  const [questionsPerVariant, setQuestionsPerVariant] = useState("20");
  const [sourceMode, setSourceMode] = useState<"xlsx" | "google_sheet">("xlsx");
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bankFilters, setBankFilters] = useState({ category: "", knowledge_type: "", type: "", difficulty: "" });
  const [structureRules, setStructureRules] = useState<Record<string, string>>({});
  const [structureDirty, setStructureDirty] = useState(false);
  const auth = { Authorization: `Bearer ${idToken}` };

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/assessments", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      setItems(await response.json());
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (idToken) void load();
  }, [idToken]);

  const publicLink = selected
    ? `${window.location.origin}/training-assessment/${selected.public_slug}`
    : "";

  useEffect(() => {
    if (!publicLink) return setQrUrl("");
    void QRCode.toDataURL(publicLink, { width: 720, margin: 2, errorCorrectionLevel: "M" }).then(setQrUrl);
  }, [publicLink]);

  const targets = useMemo(() => {
    const classTargets = classes.map((item) => ({
      value: `class:${item.id}`,
      label: `${item.partner_name || "Đơn vị"} · ${item.name}`,
    }));
    const coveredPartners = new Set(classes.map((item) => item.partner));
    const sessionTargets = sessions
      .filter((item) => item.partner_id && !coveredPartners.has(item.partner_id))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.partner_id === item.partner_id) === index)
      .map((item) => ({
        value: `session:${item.id}`,
        label: item.partner_name || item.partner || item.title,
      }));
    return [...classTargets, ...sessionTargets];
  }, [classes, sessions]);

  const participantRows = useMemo(() => parseParticipants(draft.participants_text), [draft.participants_text]);
  const computedVariantCount = Math.max(1, Math.ceil(participantRows.length / 8));
  const bankQuestions = preview?.bank_questions || [];
  const structureRows = useMemo(() => Array.from(new Map(bankQuestions.map((item) => {
    const category = String(item.category || "").trim();
    const difficulty = String(item.difficulty || "").trim();
    const key = `${category}\u241f${difficulty}`;
    return [key, {
      key,
      category,
      difficulty,
      available: bankQuestions.filter((question) => String(question.category || "").trim() === category && String(question.difficulty || "").trim() === difficulty).length,
    }];
  })).values()), [bankQuestions]);
  const structurePayload = structureRows
    .map((row) => ({ category: row.category, difficulty: row.difficulty, count: Number(structureRules[row.key] || 0) }))
    .filter((row) => row.count > 0);
  const structureTotal = structurePayload.reduce((sum, row) => sum + row.count, 0);
  const bankFilterOptions = (field: keyof typeof bankFilters) => Array.from(new Set(bankQuestions.map((item) => String(item[field] || "")).filter(Boolean))).sort();
  const filteredBankQuestions = bankQuestions.filter((item) => Object.entries(bankFilters).every(([field, value]) => !value || String(item[field] || "") === value));

  const openCreate = () => {
    setDraft(emptyDraft());
    setFile(null);
    setSheetUrl("");
    setImportMode("prepared");
    setQuestionsPerVariant("20");
    setPreview(null);
    setStructureRules({});
    setStructureDirty(false);
    setNotice("");
    setScreen("create");
  };

  const importQuestions = async () => {
    setBusy(true);
    setNotice("");
    try {
      let response: Response;
      if (sourceMode === "xlsx") {
        if (!file) throw new Error("Vui lòng chọn file XLSX.");
        const data = new FormData();
        data.append("file", file);
        data.append("import_mode", importMode);
        data.append("participant_count", String(participantRows.length));
        data.append("max_people_per_variant", "8");
        data.append("audience_group", draft.audience_group);
        if (importMode === "auto_generate") {
          data.append("variant_count", String(computedVariantCount));
          data.append("questions_per_variant", questionsPerVariant);
          data.append("structure", JSON.stringify(structurePayload));
        }
        response = await fetch("/api/digital-training/assessments/import-preview", {
          method: "POST",
          headers: auth,
          body: data,
        });
      } else {
        if (!sheetUrl.trim()) throw new Error("Vui lòng nhập đường dẫn Google Sheet.");
        response = await fetch("/api/digital-training/assessments/import-preview", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            google_sheet_url: sheetUrl.trim(),
            import_mode: importMode,
            variant_count: computedVariantCount,
            questions_per_variant: questionsPerVariant,
            participant_count: participantRows.length,
            max_people_per_variant: 8,
            audience_group: draft.audience_group,
            structure: structurePayload,
          }),
        });
      }
      if (!response.ok) throw new Error(await errorText(response));
      setPreview(await response.json());
      setStructureDirty(false);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const createAssessment = async () => {
    if (!preview || preview.errors.length) return;
    if (structureDirty) {
      setNotice("Co cau de da thay doi. Vui long bam Sinh lai cac ma de truoc khi tao dot thi.");
      return;
    }
    if (!draft.title.trim() || !draft.target) {
      setNotice("Vui lòng nhập tên bài và chọn đơn vị/phân lớp.");
      return;
    }
    if (!participantRows.length) {
      setNotice("Vui long nhap danh sach nguoi tham gia truoc khi tao dot kiem tra.");
      return;
    }
    if ((preview.available_groups || []).length > 1 && !draft.audience_group) {
      setNotice("Vui long chon nhom doi tuong cua ngan hang cau hoi va doc lai du lieu.");
      return;
    }
    const [targetType, targetId] = draft.target.split(":");
    const selectedClass = targetType === "class" ? classes.find((item) => String(item.id) === targetId) : null;
    const relatedSession = selectedClass
      ? sessions.find((item) => item.class_group_id === selectedClass.id)
      : sessions.find((item) => String(item.id) === targetId);
    const payload = {
      title: draft.title.trim(),
      training_class: selectedClass?.id || null,
      session: relatedSession?.id || null,
      duration_minutes: Number(draft.duration_minutes),
      attempt_limit: Number(draft.attempt_limit),
      opens_at: draft.opens_at || null,
      closes_at: draft.closes_at || null,
      description: draft.description,
      instructions: draft.instructions,
      status: draft.status,
      questions: preview.questions,
      generation_mode: preview.import_mode,
      generation_config: preview.generation_config || {},
      source_type: preview.source_type,
      source_name: preview.source_name,
      question_bank_url: preview.source_url || (sourceMode === "google_sheet" ? sheetUrl.trim() : ""),
      output_sheet_url: draft.output_sheet_url.trim(),
      drive_folder_id: draft.drive_folder_id.trim(),
      audience_group: draft.audience_group,
      participants: participantRows,
      max_people_per_variant: 8,
    };
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/assessments", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const created = await response.json();
      await load();
      await openDetail(created);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (item: Assessment) => {
    setSelected(item);
    setScreen("detail");
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${item.id}/results`, { headers: auth });
      if (response.ok) {
        const body = await response.json();
        const grouped = [...body].sort((a, b) => String(a.variant).localeCompare(String(b.variant), "vi") || String(a.respondent_name).localeCompare(String(b.respondent_name), "vi"));
        setResults(grouped);
        setManualScores(Object.fromEntries(body.map((result: any) => [result.id, String(result.score ?? "")])));
      }
    } catch {
      setResults([]);
    }
  };

  const gradeResult = async (result: any) => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/digital-training/assessments/${selected.id}/results/${result.id}`,
        {
          method: "PATCH",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ score: Number(manualScores[result.id]) }),
        },
      );
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const prepareOutput = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/prepare-output`, { method: "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (updated.sync_status === "error") setNotice(updated.sync_error || "Khong the khoi tao Google Sheet dau ra.");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const updateResultStorage = async (result: any, removeStored = false) => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${result.id}/storage`, { method: removeStored ? "DELETE" : "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      if (removeStored) setResults((current) => current.filter((item) => item.id !== result.id));
      else {
        const updated = await response.json();
        setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: Assessment["status"]) => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Xóa “${selected.title}” và toàn bộ lượt làm bài?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "DELETE",
        headers: auth,
      });
      if (!response.ok) throw new Error(await errorText(response));
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
      setScreen("list");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sampleRows = [
      {
        STT: 1, "Loại câu": "Trắc nghiệm", "Câu hỏi": "Nội dung câu hỏi mẫu",
        A: "Phương án A", B: "Phương án B", C: "Phương án C", D: "Phương án D",
        "Đáp án": "B", Điểm: 1, "Bắt buộc": "Có",
        "Chủ đề": "Kiến thức chung", "Độ khó": "Trung bình", "Giải thích": "", "Hình ảnh": "",
      },
      {
        STT: 2, "Loại câu": "Trả lời ngắn", "Câu hỏi": "Nhập câu trả lời ngắn",
        A: "", B: "", C: "", D: "", "Đáp án": "Câu trả lời mẫu", Điểm: 1,
        "Bắt buộc": "Có", "Chủ đề": "Vận dụng", "Độ khó": "Khó", "Giải thích": "", "Hình ảnh": "",
      },
      {
        STT: 3, "Loại câu": "Tải ảnh", "Câu hỏi": "Tải ảnh kết quả bài thực hành",
        A: "", B: "", C: "", D: "", "Đáp án": "", Điểm: 2,
        "Bắt buộc": "Có", "Chủ đề": "Thực hành", "Độ khó": "Trung bình", "Giải thích": "", "Hình ảnh": "",
      },
    ];
    if (importMode === "auto_generate") {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sampleRows), "Câu hỏi nguồn");
      XLSX.writeFile(workbook, "mau_nguon_cau_hoi_tu_dong.xlsx");
      return;
    }
    const guide = XLSX.utils.aoa_to_sheet([
      ["HƯỚNG DẪN"],
      ["Mỗi sheet Đề 1, Đề 2... là một mã đề hoàn chỉnh."],
      ["Có thể thêm hoặc bớt sheet; không đổi tên các cột dữ liệu."],
      ["Mỗi dòng là một câu hỏi. Các sheet nên có cùng số câu và tổng điểm."],
    ]);
    XLSX.utils.book_append_sheet(workbook, guide, "Hướng dẫn");
    for (let index = 1; index <= 5; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(sampleRows),
        `Đề ${index}`,
      );
    }
    XLSX.writeFile(workbook, "mau_5_ma_de_soan_san.xlsx");
  };

  const exportResults = () => {
    if (!selected || !results.length) return;
    const rows = results.map((item, index) => ({
      STT: index + 1,
      "Họ và tên": item.respondent_name,
      Email: item.email,
      "Số điện thoại": item.phone,
      "Đơn vị": item.organization,
      "Mã đề": item.variant,
      Điểm: Number(item.score || 0),
      "Điểm tối đa": Number(item.max_score || 0),
      "Trạng thái": item.status,
      "Bắt đầu": item.started_at,
      "Nộp bài": item.submitted_at,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Kết quả");
    XLSX.writeFile(workbook, `ket_qua_${selected.public_slug}.xlsx`);
  };

  if (screen === "bank" && preview) {
    return <section className="mt-6 space-y-5">
      <button onClick={() => setScreen("create")} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lai cau hinh dot thi</button>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-emerald-600">Ngan hang cau hoi</p><h2 className="mt-1 text-2xl font-extrabold">{preview.source_name}</h2><p className="mt-1 text-sm text-slate-500">{bankQuestions.length} cau - nguon {preview.source_type === "google_sheet" ? "Google Sheets" : "XLSX"}</p></div>{preview.source_url && <a href={preview.source_url} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary"><ExternalLink className="h-4 w-4" />Mo Google Sheet</a>}</div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">{(["category", "knowledge_type", "type", "difficulty"] as const).map((field) => <label key={field}><span className="mb-1 block text-xs font-bold uppercase text-slate-500">{field === "category" ? "Chu de" : field === "knowledge_type" ? "Loai cau" : field === "type" ? "Kieu cau" : "Do kho"}</span><select className="ft-input" value={bankFilters[field]} onChange={(event) => setBankFilters({ ...bankFilters, [field]: event.target.value })}><option value="">Tat ca</option>{bankFilterOptions(field).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
        <div className="mt-5 overflow-x-auto rounded-xl border"><table className="ft-table min-w-[1400px]"><thead><tr><th>Ma cau</th><th>Nhom</th><th>Chu de</th><th>Loai</th><th>Kieu</th><th>Do kho</th><th>Noi dung</th><th>Phuong an</th><th>Diem</th></tr></thead><tbody>{filteredBankQuestions.map((question) => <tr key={question.id}><td className="font-mono text-xs">{question.question_code}</td><td>{question.audience_group}</td><td>{question.category || "-"}</td><td>{question.knowledge_type || "-"}</td><td>{question.type}</td><td>{question.difficulty || "-"}</td><td className="max-w-xl whitespace-normal"><b>{question.text}</b>{question.media_url && <span className="mt-1 block text-xs text-blue-600">Media: {question.media_url}</span>}</td><td>{(question.options || []).length}</td><td>{question.points}</td></tr>)}</tbody></table></div>
      </div>
    </section>;
  }

  if (screen === "create") {
    return (
      <section className="mt-6 space-y-5">
        <button onClick={() => setScreen("list")} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lại danh sách</button>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Khảo sát kết thúc tập huấn</p><h2 className="mt-1 text-2xl font-extrabold">Tạo một link, chia đều nhiều mã đề</h2><p className="mt-2 text-sm text-slate-500">Chọn nhập đề soạn sẵn hoặc tự động sinh mã đề trực tiếp từ XLSX/Google Sheet.</p></div>
            <button onClick={downloadTemplate} className="ft-btn ft-btn-secondary"><Download className="h-4 w-4" />{importMode === "auto_generate" ? "Tải mẫu nguồn câu hỏi" : "Tải mẫu 5 mã đề"}</button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => { setImportMode("prepared"); setPreview(null); setStructureRules({}); setStructureDirty(false); }}
              className={`rounded-2xl border-2 p-4 text-left transition ${importMode === "prepared" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}
            >
              <span className="flex items-center gap-2 font-extrabold text-[#001e40]"><Layers3 className="h-5 w-5 text-blue-600" />Nhập 4–5 đề soạn sẵn</span>
              <span className="mt-2 block text-sm text-slate-600">Một file XLSX/Google Sheet, mỗi mã đề là một sheet hoàn chỉnh.</span>
            </button>
            <button
              type="button"
              onClick={() => { setImportMode("auto_generate"); setPreview(null); setStructureRules({}); setStructureDirty(false); }}
              className={`rounded-2xl border-2 p-4 text-left transition ${importMode === "auto_generate" ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-200"}`}
            >
              <span className="flex items-center gap-2 font-extrabold text-[#001e40]"><Shuffle className="h-5 w-5 text-emerald-600" />Tự động sinh đề từ file nhập</span>
              <span className="mt-2 block text-sm text-slate-600">Đọc trực tiếp XLSX/Google Sheet, tạo các mã đề để duyệt; không tạo thêm kho dữ liệu riêng.</span>
            </button>
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Tên bài *</span><input className="ft-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Bài kiểm tra cuối học phần" /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Đơn vị / phân lớp *</span><select className="ft-input" value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })}><option value="">Chọn đơn vị hoặc phân lớp</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select><small className="mt-1 block text-slate-500">Mỗi đơn vị/phân lớp chỉ có một khảo sát kết thúc tập huấn và một link công khai.</small></label>
                {(preview?.available_groups || []).length > 0 && <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Nhom doi tuong trong ngan hang *</span><select className="ft-input" value={draft.audience_group} onChange={(event) => { setDraft({ ...draft, audience_group: event.target.value }); setPreview(null); }}><option value="">Chon nhom doi tuong</option>{(preview?.available_groups || []).map((group) => <option key={group} value={group}>{group}</option>)}</select><small className="mt-1 block text-slate-500">Sau khi chon nhom, bam doc lai du lieu de tao dung cau hoi.</small></label>}
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Danh sach nguoi tham gia *</span><textarea className="ft-input min-h-32 font-mono text-xs" value={draft.participants_text} onChange={(event) => { setDraft({ ...draft, participants_text: event.target.value }); setPreview(null); }} placeholder={'Ma, Ho ten, Email, So dien thoai, Don vi, Nhom\nGV-001, Nguyen Van A, a@example.com, 090..., Truong A, THPT'} /><small className="mt-1 block text-slate-500">{participantRows.length} nguoi - he thong tu tinh {computedVariantCount} ma de, toi da 8 nguoi/ma.</small></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Google Sheet dau ra cua dot thi</span><input type="url" className="ft-input" value={draft.output_sheet_url} onChange={(event) => setDraft({ ...draft, output_sheet_url: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." /><small className="mt-1 block text-slate-500">File rieng cua khach hang; he thong tao Tong quan, Phan de, De, Bai lam va Nhat ky xoa.</small></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Google Drive Folder ID luu anh</span><input className="ft-input" value={draft.drive_folder_id} onChange={(event) => setDraft({ ...draft, drive_folder_id: event.target.value })} placeholder="Folder ID" /></label>
                <label><span className="mb-1 block text-sm font-bold">Thời gian làm bài (phút)</span><input type="number" min="1" max="480" className="ft-input" value={draft.duration_minutes} onChange={(event) => setDraft({ ...draft, duration_minutes: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Số lượt tối đa/người</span><input type="number" min="1" max="20" className="ft-input" value={draft.attempt_limit} onChange={(event) => setDraft({ ...draft, attempt_limit: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Mở từ</span><input type="datetime-local" className="ft-input" value={draft.opens_at} onChange={(event) => setDraft({ ...draft, opens_at: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Đóng lúc</span><input type="datetime-local" className="ft-input" value={draft.closes_at} onChange={(event) => setDraft({ ...draft, closes_at: event.target.value })} /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Mô tả</span><textarea className="ft-input min-h-20" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Hướng dẫn người làm</span><textarea className="ft-input min-h-24" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
              </div>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-5">
              <h3 className="font-extrabold">{importMode === "auto_generate" ? "File câu hỏi nguồn" : "Nguồn các mã đề"}</h3>
              {importMode === "auto_generate" && <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <label><span className="mb-1 block text-xs font-bold text-emerald-900">Số mã đề</span><input type="number" min="2" max="10" className="ft-input bg-white" value={computedVariantCount} readOnly /><small className="mt-1 block text-[11px] text-emerald-800">Khuyến nghị 4–5</small></label>
                <label><span className="mb-1 block text-xs font-bold text-emerald-900">Số câu/mã đề</span><input type="number" min="1" max="200" className="ft-input bg-white" value={questionsPerVariant} onChange={(event) => { setQuestionsPerVariant(event.target.value); setPreview(null); setStructureRules({}); setStructureDirty(false); }} /></label>
              </div>}
              <div className="mt-3 grid grid-cols-2 rounded-xl bg-slate-200 p-1 text-sm font-bold">
                <button onClick={() => { setSourceMode("xlsx"); setPreview(null); setStructureRules({}); setStructureDirty(false); }} className={`rounded-lg px-3 py-2 ${sourceMode === "xlsx" ? "bg-white shadow-sm" : ""}`}>Tệp XLSX</button>
                <button onClick={() => { setSourceMode("google_sheet"); setPreview(null); setStructureRules({}); setStructureDirty(false); }} className={`rounded-lg px-3 py-2 ${sourceMode === "google_sheet" ? "bg-white shadow-sm" : ""}`}>Google Sheet</button>
              </div>
              {sourceMode === "xlsx" ? <label className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center"><FileSpreadsheet className="h-9 w-9 text-emerald-600" /><b className="mt-2">{file?.name || "Chọn file .xlsx"}</b><span className="mt-1 text-xs text-slate-500">{importMode === "prepared" ? "Một file chứa toàn bộ 4–5 sheet đề" : "Một sheet chứa các câu hỏi nguồn"} · Tối đa 10 MB</span><input type="file" accept=".xlsx" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} /></label> : <label className="mt-4 block"><span className="mb-1 block text-sm font-bold">Đường dẫn Google Sheet</span><input className="ft-input" value={sheetUrl} onChange={(event) => { setSheetUrl(event.target.value); setPreview(null); }} placeholder="https://docs.google.com/spreadsheets/d/..." /><small className="mt-2 block text-slate-500">Sheet cần bật “Bất kỳ ai có đường liên kết đều có thể xem”. Hệ thống đọc toàn bộ các tab.</small></label>}
              <button disabled={busy} onClick={importQuestions} className="ft-primary mt-4 w-full justify-center"><Upload className="h-4 w-4" />{importMode === "auto_generate" ? (preview ? "Sinh lại các mã đề" : "Đọc file và tự động sinh đề") : "Đọc và kiểm tra dữ liệu"}</button>
              {preview && <div className="mt-4 space-y-3">
                <div className={`grid gap-2 ${preview.import_mode === "auto_generate" ? "grid-cols-3" : "grid-cols-2"}`}>
                  {preview.import_mode === "auto_generate" && <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.source_question_count}</b><span className="block text-xs text-slate-500">câu trong file nguồn</span></div>}
                  <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.variants.length}</b><span className="block text-xs text-slate-500">mã đề</span></div>
                  <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.question_count}</b><span className="block text-xs text-slate-500">câu sau khi chia</span></div>
                </div>
                <div className="flex flex-wrap gap-2">{preview.variants.map((variant) => <span key={variant.name} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{variant.name}: {variant.question_count} câu</span>)}</div>
                {preview.import_mode === "auto_generate" && !!structureRows.length && <div className="rounded-xl border bg-white p-3">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-extrabold uppercase text-slate-500">Co cau chu de / do kho</p><p className="mt-1 text-xs text-slate-500">De trong neu muon he thong chia theo ty le ngan hang.</p></div><b className={`text-sm ${structureTotal > 0 && structureTotal !== Number(questionsPerVariant) ? "text-rose-600" : "text-emerald-700"}`}>{structureTotal || "Tu dong"}{structureTotal > 0 ? ` / ${questionsPerVariant} cau` : ""}</b></div>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{structureRows.map((row) => <label key={row.key} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-lg bg-slate-50 p-2"><span className="text-xs"><b>{row.category || "Khong chu de"}</b><span className="block text-[11px] text-slate-500">{row.difficulty || "Khong do kho"} - co {row.available} cau</span></span><input type="number" min="0" max={row.available} className="rounded-lg border px-2 py-1.5 text-sm" value={structureRules[row.key] || ""} placeholder="0" onChange={(event) => { setStructureRules((current) => ({ ...current, [row.key]: event.target.value })); setStructureDirty(true); }} /></label>)}</div>
                  {structureDirty && <p className="mt-2 text-xs font-bold text-amber-700">Da doi co cau. Bam Sinh lai cac ma de de ap dung.</p>}
                </div>}
                {!!bankQuestions.length && <button type="button" onClick={() => setScreen("bank")} className="ft-btn ft-btn-secondary w-full justify-center"><FileSpreadsheet className="h-4 w-4" />Mo trang ngan hang cau hoi ({bankQuestions.length})</button>}
                {preview.warnings.map((warning) => <p key={warning} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{warning}</p>)}
                {preview.errors.map((error) => <p key={error} className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>)}
                {!preview.errors.length && <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border bg-white p-2">
                  <p className="px-2 pt-1 text-xs font-extrabold uppercase text-slate-500">Xem trước từng mã đề</p>
                  {preview.variants.map((variant, variantIndex) => <details key={variant.name} open={variantIndex === 0} className="rounded-lg border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-extrabold text-[#001e40]">{variant.name} · {variant.question_count} câu</summary>
                    <ol className="space-y-2 border-t p-3">
                      {preview.questions.filter((question) => question.variant === variant.name).map((question) => <li key={question.id} className="text-xs text-slate-700">
                        <b>{question.order}. {question.text}</b>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {question.type === "single_choice" ? `Đáp án: ${(question.correct_answers || []).join(", ")}` : question.type === "short_answer" ? "Trả lời ngắn" : "Tải ảnh thực hành"}
                          {question.category ? ` · ${question.category}` : ""}
                          {question.difficulty ? ` · ${question.difficulty}` : ""}
                        </span>
                      </li>)}
                    </ol>
                  </details>)}
                </div>}
              </div>}
            </div>
          </div>
          {notice && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.status === "published"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "published" : "draft" })} />Phát hành ngay sau khi tạo</label>
            <button disabled={busy || !preview || preview.errors.length > 0 || structureDirty} onClick={createAssessment} className="ft-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Tạo khảo sát kết thúc</button>
          </div>
        </div>
      </section>
    );
  }

  if (screen === "detail" && selected) {
    return (
      <section className="mt-6 space-y-5">
        <button onClick={() => { setScreen("list"); setSelected(null); }} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lại danh sách</button>
        <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div><p className="text-xs font-bold uppercase text-blue-600">Khảo sát kết thúc tập huấn</p><h2 className="mt-1 text-2xl font-extrabold">{selected.title}</h2><p className="mt-2 text-sm text-slate-500">{[selected.partner_name, selected.class_name].filter(Boolean).join(" · ")}</p></div>
            <div className="flex flex-wrap gap-2">{selected.status !== "published" && <button onClick={() => void changeStatus("published")} className="ft-primary"><Send className="h-4 w-4" />Phát hành</button>}{selected.status === "published" && <button onClick={() => void changeStatus("closed")} className="ft-btn ft-btn-secondary">Đóng bài</button>}<button disabled={busy || !selected.output_sheet_url} onClick={() => void prepareOutput()} className="ft-btn ft-btn-secondary"><FileSpreadsheet className="h-4 w-4" />Khoi tao Sheet dau ra</button><button onClick={() => void remove()} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700"><Trash2 className="h-4 w-4" /></button></div>
          </div>
          <div className="grid gap-5 border-t bg-slate-50 p-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${selected.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{statusLabel[selected.status]}</span><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{selected.generation_mode === "auto_generate" ? "Tự động sinh từ file" : "Đề soạn sẵn"}</span><span className="text-sm text-slate-500">{selected.duration_minutes} phút · tối đa {selected.attempt_limit} lượt/người</span></div>
              <div className="mt-5 rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-slate-500">Một link dùng chung</p><div className="mt-2 flex gap-2"><input readOnly value={publicLink} className="ft-input font-mono text-sm" /><button onClick={() => void navigator.clipboard.writeText(publicLink)} className="ft-btn ft-btn-secondary shrink-0"><ClipboardCopy className="h-4 w-4" />Sao chép</button><a href={publicLink} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary shrink-0"><ExternalLink className="h-4 w-4" /></a></div><p className="mt-2 text-xs text-slate-500">Tất cả người học dùng link này; hệ thống tự chia mã đề có ít lượt nhất.</p></div>
              <div className="mt-4 flex flex-wrap gap-2">{selected.variants.map((variant) => <span key={variant.name} className="rounded-full bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-800">{variant.name}: {variant.question_count} câu · {selected.variant_distribution[variant.name] || 0} lượt</span>)}</div>
            </div>
            <div className="rounded-xl border bg-white p-3 text-center">{qrUrl ? <img src={qrUrl} alt="QR bài đánh giá" className="mx-auto aspect-square w-full object-contain" /> : <QrCode className="mx-auto h-20 w-20 text-slate-300" />}<a href={qrUrl} download={`qr-${selected.public_slug}.png`} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Download className="h-3.5 w-3.5" />Tải QR</a></div>
          </div>
        </article>
        <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border bg-white p-5"><Users className="h-5 w-5 text-blue-600" /><b className="mt-3 block text-3xl">{selected.attempts_count}</b><span className="text-sm text-slate-500">Lượt bắt đầu</span></div><div className="rounded-2xl border bg-white p-5"><Check className="h-5 w-5 text-emerald-600" /><b className="mt-3 block text-3xl">{selected.submitted_count}</b><span className="text-sm text-slate-500">Bài đã nộp</span></div><div className="rounded-2xl border bg-white p-5"><BarChart3 className="h-5 w-5 text-amber-600" /><b className="mt-3 block text-3xl">{selected.average_score ?? "—"}{selected.average_score != null && "%"}</b><span className="text-sm text-slate-500">Điểm trung bình</span></div></div>
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 p-5"><div><h3 className="text-lg font-extrabold">Kết quả người học</h3><p className="text-sm text-slate-500">Câu ảnh thực hành và câu ngắn không có đáp án cần chấm bổ sung.</p></div><button disabled={!results.length} onClick={exportResults} className="ft-btn ft-btn-secondary"><Download className="h-4 w-4" />Xuất XLSX</button></div>
          <div className="overflow-x-auto"><table className="ft-table min-w-[1120px]"><thead><tr><th>STT</th><th>Người học</th><th>Liên hệ</th><th>Đơn vị</th><th>Mã đề</th><th>Bài thực hành</th><th>Điểm</th><th>Trạng thái</th><th>Nộp lúc</th></tr></thead><tbody>{results.length ? results.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><b>{item.respondent_name}</b></td><td>{item.email || item.phone || "—"}</td><td>{item.organization || "—"}</td><td>{item.variant}</td><td>{item.uploads?.length ? <div className="space-y-1">{item.uploads.map((upload: any, uploadIndex: number) => <a key={upload.id} href={upload.url} target="_blank" rel="noreferrer" className="block text-xs font-bold text-blue-700 underline">Xem ảnh {uploadIndex + 1}</a>)}</div> : "—"}</td><td>{item.manual_grading_required ? <div className="flex min-w-40 items-center gap-2"><input type="number" min="0" max={Number(item.max_score || 0)} step="0.25" value={manualScores[item.id] ?? ""} onChange={(event) => setManualScores((current) => ({ ...current, [item.id]: event.target.value }))} className="w-20 rounded-lg border px-2 py-1.5 text-sm" aria-label="Tổng điểm sau chấm thủ công" /><span className="text-xs text-slate-500">/ {Number(item.max_score || 0).toLocaleString("vi-VN")}</span><button disabled={busy} onClick={() => void gradeResult(item)} className="rounded-lg bg-blue-600 px-2 py-1.5 text-xs font-bold text-white">Lưu</button></div> : <b>{Number(item.score || 0).toLocaleString("vi-VN")} / {Number(item.max_score || 0).toLocaleString("vi-VN")}</b>}</td><td>{item.status === "submitted" ? "Đã nộp" : item.status === "timed_out" ? "Hết giờ" : "Đang làm"}<div className={`mt-2 text-[11px] font-bold ${item.sync_status === "synced" ? "text-emerald-600" : item.sync_status === "error" ? "text-rose-600" : "text-amber-600"}`}>Sync: {item.sync_status || "pending"}</div><div className="mt-1 flex gap-1">{item.status !== "in_progress" && item.sync_status !== "synced" && <button disabled={busy} onClick={() => void updateResultStorage(item)} className="rounded border px-2 py-1 text-[11px] font-bold">Thu lai</button>}{item.sync_status === "synced" && <button disabled={busy} onClick={() => { if (window.confirm("Xoa du lieu tam da dong bo?")) void updateResultStorage(item, true); }} className="rounded border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-600">Xoa tam</button>}</div></td><td>{item.submitted_at ? new Date(item.submitted_at).toLocaleString("vi-VN") : "—"}</td></tr>) : <tr><td colSpan={9} className="py-10 text-center text-slate-500">Chưa có lượt làm bài.</td></tr>}</tbody></table></div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div><h2 className="text-xl font-extrabold">Khảo sát kết thúc tập huấn</h2><p className="mt-1 text-sm text-slate-500">Một link cho mỗi đơn vị/phân lớp, tự chia đều 4–5 mã đề và chấm điểm tập trung.</p></div>
        {!isGuest && <div className="flex gap-2"><button onClick={() => void load()} className="ft-btn ft-btn-secondary"><RefreshCw className="h-4 w-4" /></button><button onClick={openCreate} className="ft-primary"><Plus className="h-4 w-4" />Tạo khảo sát kết thúc</button></div>}
      </div>
      {notice && <p className="mx-5 mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
      <div className="overflow-x-auto"><table className="ft-table min-w-[1050px]"><thead><tr><th>STT</th><th>Nguoi</th><th>Bài đánh giá</th><th>Đơn vị / phân lớp</th><th>Mã đề</th><th>Thời gian</th><th>Lượt làm</th><th>Điểm TB</th><th>Trạng thái</th></tr></thead><tbody>{items.length ? items.map((item, index) => <tr key={item.id} onClick={() => void openDetail(item)} className="cursor-pointer hover:bg-blue-50"><td>{index + 1}</td><td><b>{item.participant_count || 0}</b><span className="block text-xs text-slate-500">toi da {item.max_people_per_variant || 8}/ma</span></td><td><b>{item.title}</b><span className="mt-1 block text-xs font-bold text-blue-600">{item.generation_mode === "auto_generate" ? "Tự động sinh từ file" : "Đề soạn sẵn"}</span><span className="mt-1 block font-mono text-xs text-slate-400">/training-assessment/{item.public_slug}</span></td><td>{item.partner_name || "—"}<span className="block text-xs text-slate-500">{item.class_name || "Không chia lớp"}</span></td><td>{item.variants.length}<span className="block text-xs text-slate-500">{item.variants.map((variant) => variant.name).join(", ")}</span></td><td><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.duration_minutes} phút</span></td><td>{item.submitted_count} / {item.attempts_count}</td><td>{item.average_score == null ? "—" : `${item.average_score}%`}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.status === "published" ? "bg-emerald-100 text-emerald-800" : item.status === "closed" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>{statusLabel[item.status]}</span><span className={`mt-1 block text-[11px] font-bold ${item.sync_counts?.error ? "text-rose-600" : item.sync_counts?.pending ? "text-amber-600" : "text-emerald-600"}`}>Sync: {item.sync_counts?.synced || 0}/{item.submitted_count}{item.sync_counts?.error ? ` - ${item.sync_counts.error} loi` : ""}</span></td></tr>) : <tr><td colSpan={8} className="py-12 text-center text-slate-500">{busy ? "Đang tải..." : "Chưa có bài kiểm tra cuối tập huấn."}</td></tr>}</tbody></table></div>
    </section>
  );
}
