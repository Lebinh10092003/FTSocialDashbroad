import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileImage,
  Loader2,
  Save,
  Send,
  ShieldCheck,
} from "lucide-react";

type PublicQuestion = {
  id: string;
  order: number;
  type: "single_choice" | "short_answer" | "file_upload";
  text: string;
  options?: Array<{ key: string; text: string }>;
  points: number;
  required: boolean;
  image_url?: string;
};

const apiError = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  return body.error || Object.values(body)[0] || "Không thể xử lý yêu cầu.";
};

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return [hours, minutes, rest]
    .filter((_, index) => index > 0 || hours > 0)
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

export default function TrainingAssessmentPublic({ slug }: { slug: string }) {
  const [assessment, setAssessment] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [identity, setIdentity] = useState({
    respondent_name: "",
    email: "",
    phone: "",
    organization: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState("Đã lưu");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const submittingRef = useRef(false);
  const storageKey = `ft-training-assessment:${slug}`;

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const savedToken = localStorage.getItem(storageKey);
      if (savedToken) {
        const response = await fetch(`/api/training-assessment-attempts/${savedToken}`);
        if (response.ok) {
          const body = await response.json();
          setAttempt(body);
          setAssessment(body.assessment);
          setAnswers(body.answers || {});
          return;
        }
        localStorage.removeItem(storageKey);
      }
      const response = await fetch(`/api/training-assessments/${slug}`);
      if (!response.ok) throw new Error(await apiError(response));
      setAssessment(await response.json());
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slug]);

  const save = async (submit = false) => {
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    if (submit && submittingRef.current) return;
    if (submit) submittingRef.current = true;
    setSaveState(submit ? "Đang nộp bài..." : "Đang lưu...");
    try {
      const response = await fetch(
        `/api/training-assessment-attempts/${attempt.access_token}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, submit }),
        },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      setAttempt(body);
      if (submit) setAnswers(body.answers || answers);
      setSaveState(submit ? "Đã nộp bài" : "Đã lưu");
      if (body.status !== "in_progress") localStorage.removeItem(storageKey);
    } catch (error: any) {
      setMessage(String(error?.message || error));
      setSaveState("Chưa lưu được");
    } finally {
      if (submit) submittingRef.current = false;
    }
  };

  useEffect(() => {
    if (!attempt?.expires_at || attempt.status !== "in_progress") return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(attempt.expires_at).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0 && !submittingRef.current) void save(true);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [attempt?.expires_at, attempt?.status, answers]);

  useEffect(() => {
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    setSaveState("Có thay đổi chưa lưu");
    const timer = window.setTimeout(() => void save(false), 900);
    return () => window.clearTimeout(timer);
  }, [answers]);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/training-assessments/${slug}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      localStorage.setItem(storageKey, body.access_token);
      setAttempt(body);
      setAssessment(body.assessment);
      setAnswers(body.answers || {});
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (question: PublicQuestion, file?: File) => {
    if (!file || !attempt?.access_token) return;
    setBusy(true);
    setMessage("");
    const data = new FormData();
    data.append("question_id", question.id);
    data.append("file", file);
    try {
      const response = await fetch(
        `/api/training-assessment-attempts/${attempt.access_token}/upload`,
        { method: "POST", body: data },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      setAnswers((current) => ({ ...current, [question.id]: `upload:${body.id}` }));
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const unansweredRequired = useMemo(
    () =>
      (attempt?.questions || []).filter(
        (question: PublicQuestion) =>
          question.required && !String(answers[question.id] || "").trim(),
      ).length,
    [attempt?.questions, answers],
  );

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">
        <Loader2 className="h-9 w-9 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <div className="max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Không mở được bài đánh giá</h1>
          <p className="mt-2 text-slate-600">{message || "Đường dẫn không hợp lệ."}</p>
        </div>
      </div>
    );
  }

  if (!attempt) {
    const isOpen = assessment.availability === "open";
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_35%),linear-gradient(180deg,#f8fafc,#eef2ff)] px-4 py-8 text-slate-900">
        <main className="mx-auto max-w-3xl">
          <header className="mb-5 flex items-center gap-3">
            <img src="/logo.png" alt="FermatTech" className="h-9 object-contain" />
            <span className="border-l pl-3 text-sm font-bold text-slate-600">Training Assessment</span>
          </header>
          <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl shadow-blue-950/10">
            <div className="bg-gradient-to-br from-[#001e40] via-[#0049a8] to-[#00a77a] px-6 py-8 text-white sm:px-10">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Bài đánh giá cuối học phần</p>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight">{assessment.title}</h1>
              <p className="mt-3 text-blue-100">
                {[assessment.partner_name, assessment.class_name].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.duration_minutes} phút</b><span className="block text-xs text-blue-100">Thời gian làm bài</span></div>
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.question_count} câu</b><span className="block text-xs text-blue-100">Mỗi mã đề</span></div>
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.variant_count} mã đề</b><span className="block text-xs text-blue-100">Hệ thống tự chia đều</span></div>
              </div>
            </div>
            <div className="p-6 sm:p-10">
              {assessment.description && <p className="mb-4 leading-7 text-slate-700">{assessment.description}</p>}
              {assessment.instructions && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <b className="block">Hướng dẫn</b>{assessment.instructions}
                </div>
              )}
              {!isOpen ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 font-semibold text-amber-900">
                  {assessment.message}
                </div>
              ) : (
                <form onSubmit={start} className="grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Họ và tên *</span><input required className="ft-input" value={identity.respondent_name} onChange={(event) => setIdentity({ ...identity, respondent_name: event.target.value })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Email</span><input type="email" className="ft-input" value={identity.email} onChange={(event) => setIdentity({ ...identity, email: event.target.value })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Số điện thoại</span><input className="ft-input" value={identity.phone} onChange={(event) => setIdentity({ ...identity, phone: event.target.value })} /></label>
                  <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Đơn vị công tác</span><input className="ft-input" value={identity.organization} onChange={(event) => setIdentity({ ...identity, organization: event.target.value })} /></label>
                  <p className="sm:col-span-2 text-xs text-slate-500">Nhập email hoặc số điện thoại để hệ thống quản lý số lượt làm. Mã đề được cấp tự động sau khi bắt đầu.</p>
                  {message && <p className="sm:col-span-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
                  <button disabled={busy} className="ft-primary sm:col-span-2 sm:justify-center">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Bắt đầu làm bài
                  </button>
                </form>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (attempt.status !== "in_progress") {
    const percent = Number(attempt.max_score) > 0
      ? Math.round((Number(attempt.score || 0) / Number(attempt.max_score)) * 100)
      : 0;
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <section className="w-full max-w-2xl rounded-3xl border bg-white p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h1 className="mt-4 text-3xl font-extrabold text-slate-900">Đã ghi nhận bài làm</h1>
          <p className="mt-2 text-slate-600">{attempt.respondent_name} · {assessment.partner_name}</p>
          <div className="mx-auto mt-7 max-w-sm rounded-2xl bg-slate-900 p-6 text-white">
            <p className="text-sm text-slate-300">Điểm tự động</p>
            <p className="mt-1 text-4xl font-black">{Number(attempt.score || 0).toLocaleString("vi-VN")} / {Number(attempt.max_score || 0).toLocaleString("vi-VN")}</p>
            <p className="mt-2 text-sm text-slate-300">{percent}%</p>
          </div>
          {attempt.manual_grading_required && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Bài có câu trả lời ngắn hoặc ảnh thực hành cần giảng viên chấm bổ sung.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0"><p className="truncate text-sm font-extrabold">{assessment.title}</p><p className="text-xs text-slate-500">{attempt.variant} · {attempt.respondent_name}</p></div>
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-black ${secondsLeft < 300 ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-800"}`}><Clock3 className="h-5 w-5" />{formatCountdown(secondsLeft)}</div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {message && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</div>}
        <div className="mb-5 flex items-center justify-between text-xs text-slate-500"><span>{attempt.questions.length} câu hỏi</span><span className="inline-flex items-center gap-1"><Save className="h-3.5 w-3.5" />{saveState}</span></div>
        <div className="space-y-5">
          {attempt.questions.map((question: PublicQuestion, index: number) => (
            <article key={question.id} className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#001e40] text-sm font-black text-white">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-bold leading-7">{question.text}{question.required && <span className="ml-1 text-rose-500">*</span>}</h2><span className="text-xs font-semibold text-slate-400">{question.points} điểm</span></div>
                  {question.image_url && <img src={question.image_url} alt="" className="mt-4 max-h-80 rounded-xl border object-contain" />}
                  {question.type === "single_choice" && <div className="mt-5 grid gap-3">{(question.options || []).map((option) => <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${answers[question.id] === option.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "hover:border-slate-400"}`}><input type="radio" name={question.id} className="mt-1" checked={answers[question.id] === option.key} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.key }))} /><b className="text-blue-800">{option.key}.</b><span>{option.text}</span></label>)}</div>}
                  {question.type === "short_answer" && <textarea rows={3} className="ft-input mt-5 resize-y" value={answers[question.id] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Nhập câu trả lời..." />}
                  {question.type === "file_upload" && <label className="mt-5 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-blue-400 hover:bg-blue-50"><FileImage className="h-8 w-8 text-blue-600" /><b className="mt-2">{answers[question.id] ? "Đã tải ảnh lên" : "Tải ảnh bài thực hành"}</b><span className="mt-1 text-xs text-slate-500">JPG, PNG, WEBP · tối đa 5 MB</span><input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(question, event.target.files?.[0])} /></label>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-white p-4 shadow-[0_-8px_24px_rgba(15,23,42,.08)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <p className="text-sm text-slate-600">{unansweredRequired ? `Còn ${unansweredRequired} câu bắt buộc chưa trả lời` : "Đã trả lời đủ các câu bắt buộc"}</p>
          <button disabled={busy || unansweredRequired > 0} onClick={() => { if (window.confirm("Nộp bài ngay? Sau khi nộp bạn không thể sửa câu trả lời.")) void save(true); }} className="ft-primary disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />Nộp bài</button>
        </div>
      </footer>
    </div>
  );
}
