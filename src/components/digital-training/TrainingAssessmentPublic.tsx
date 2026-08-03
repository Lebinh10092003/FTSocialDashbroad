import React, { useEffect, useMemo, useRef, useState } from "react";
import { appDialog } from "../AppDialog";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileUp,
  GripVertical,
  Link2,
  Loader2,
  ListChecks,
  PlayCircle,
  Save,
  Send,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";

type PublicQuestion = {
  id: string;
  question_code?: string;
  order: number;
  type: "single_choice" | "multiple_choice" | "short_answer" | "matching" | "ordering" | "practical_submission" | "file_upload";
  knowledge_type?: string;
  text: string;
  options?: Array<{ key: string; text: string; match_text?: string }>;
  points: number;
  required: boolean;
  image_url?: string;
  media_url?: string;
  media_file_id?: string;
  category?: string;
  difficulty?: string;
};

type AnswerValue = string | string[] | Record<string, string>;

const hasQuestionAnswer = (question: PublicQuestion, value?: AnswerValue) => {
  if (question.type === "matching") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const selected = Object.values(value).filter((item) => String(item || "").trim());
    return selected.length === (question.options || []).length;
  }
  if (question.type === "ordering") {
    return typeof value === "string"
      && value.split("-").filter(Boolean).length === (question.options || []).length;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => String(item || "").trim());
  }
  return Boolean(String(value || "").trim());
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

const mediaPreview = (source = "") => {
  const value = source.trim();
  const youtube = value.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (youtube) return { kind: "video", url: `https://www.youtube.com/embed/${youtube[1]}` };
  const drive = value.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
  if (drive) return { kind: "video", url: `https://drive.google.com/file/d/${drive[1]}/preview` };
  if (/^https?:\/\/.+\.(?:png|jpe?g|gif|webp)(?:\?.*)?$/i.test(value)) return { kind: "image", url: value };
  return value.startsWith("http") ? { kind: "link", url: value } : null;
};

export default function TrainingAssessmentPublic({ slug }: { slug: string }) {
  const [assessment, setAssessment] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [identity, setIdentity] = useState({
    respondent_name: "",
    email: "",
    phone: "",
    organization: "",
    participant_code: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState("Đã lưu");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const submittingRef = useRef(false);
  const storageKey = `ft-training-assessment:${slug}`;

  const restoreAttempt = (body: any) => {
    setAttempt(body);
    setAssessment(body.assessment);
    setAnswers(body.answers || {});
    const reviewed = Array.isArray(body.progress?.reviewed_question_ids) ? body.progress.reviewed_question_ids : [];
    setReviewedIds(reviewed);
    const questionIndex = (body.questions || []).findIndex((item: PublicQuestion) => item.id === body.progress?.current_question_id);
    setCurrentIndex(questionIndex >= 0 ? questionIndex : 0);
  };

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const savedToken = localStorage.getItem(storageKey);
      if (savedToken) {
        const response = await fetch(`/api/training-assessment-attempts/${savedToken}`);
        if (response.ok) {
          const body = await response.json();
          restoreAttempt(body);
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
          body: JSON.stringify({
            answers,
            submit,
            progress: {
              current_question_id: attempt.questions?.[currentIndex]?.id || "",
              reviewed_question_ids: reviewedIds,
            },
          }),
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
  }, [answers, currentIndex, reviewedIds]);

  useEffect(() => {
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    const persistBeforeLeaving = () => {
      void fetch('/api/training-assessment-attempts/' + attempt.access_token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          answers,
          progress: {
            current_question_id: attempt.questions?.[currentIndex]?.id || "",
            reviewed_question_ids: reviewedIds,
          },
        }),
      });
    };
    window.addEventListener("pagehide", persistBeforeLeaving);
    return () => window.removeEventListener("pagehide", persistBeforeLeaving);
  }, [attempt?.access_token, attempt?.status, answers, currentIndex, reviewedIds]);

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
      restoreAttempt(body);
      if (body.resumed) {
        void appDialog.alert("Hệ thống đã tìm thấy bài đang làm theo đúng họ tên và thông tin liên hệ. Câu trả lời và thời gian còn lại đã được khôi phục.", { title: "Đã khôi phục bài làm", tone: "success" });
      }
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (question: PublicQuestion, file?: File) => {
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
      setAnswers((current) => {
        const existing = current[question.id];
        const practical = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : { link: typeof existing === "string" ? existing : "" };
        return { ...current, [question.id]: { ...practical, upload_id: String(body.id), upload_file_id: String(body.file_id || ""), upload_url: String(body.url || "") } };
      });
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const resetAttempt = async () => {
    if (!attempt) return;
    const confirmed = await appDialog.confirm(
      "Toàn bộ câu trả lời và tệp đã tải của lượt đang làm sẽ bị xóa; đồng hồ được tính lại theo thời gian còn mở của bài. Tiếp tục?",
      { title: "Làm lại lượt hiện tại", confirmText: "Xóa và làm lại", tone: "danger" },
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch('/api/training-assessments/' + slug + '/start', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respondent_name: attempt.respondent_name,
          email: attempt.email,
          phone: attempt.phone,
          participant_code: attempt.participant_code,
          reset: true,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      restoreAttempt(body);
      setCurrentIndex(0);
      setReviewMode(false);
      setSaveState("Đã làm lại và lưu");
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
          question.required && !hasQuestionAnswer(question, answers[question.id]),
      ).length,
    [attempt?.questions, answers],
  );

  const questions: PublicQuestion[] = attempt?.questions || [];
  const currentQuestion = questions[currentIndex] || questions[0];
  const currentMedia = currentQuestion ? mediaPreview(currentQuestion.media_url || currentQuestion.image_url || "") : null;
  const setAnswer = (questionId: string, value: AnswerValue) => setAnswers((current) => ({ ...current, [questionId]: value }));
  useEffect(() => {
    if (currentQuestion?.type !== "ordering" || answers[currentQuestion.id]) return;
    const initialOrder = (currentQuestion.options || []).map((item) => item.key).join("-");
    if (initialOrder) setAnswer(currentQuestion.id, initialOrder);
  }, [currentQuestion?.id, currentQuestion?.type]);
  const toggleMultiple = (questionId: string, key: string) => {
    const current = Array.isArray(answers[questionId]) ? answers[questionId] as string[] : [];
    setAnswer(questionId, current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const moveOrdering = (question: PublicQuestion, from: number, direction: -1 | 1) => {
    const stored = typeof answers[question.id] === "string" ? String(answers[question.id]).split("-").filter(Boolean) : [];
    const order = stored.length === (question.options || []).length ? stored : (question.options || []).map((item) => item.key);
    const target = from + direction;
    if (target < 0 || target >= order.length) return;
    [order[from], order[target]] = [order[target], order[from]];
    setAnswer(question.id, order.join("-"));
  };
  const reorderOrdering = (question: PublicQuestion, draggedKey: string, targetIndex: number) => {
    const stored = typeof answers[question.id] === "string" ? String(answers[question.id]).split("-").filter(Boolean) : [];
    const order = stored.length === (question.options || []).length ? stored : (question.options || []).map((item) => item.key);
    const from = order.indexOf(draggedKey);
    if (from < 0 || targetIndex < 0 || targetIndex >= order.length) return;
    order.splice(targetIndex, 0, order.splice(from, 1)[0]);
    setAnswer(question.id, order.join("-"));
  };
  const setMatching = (questionId: string, leftKey: string, rightKey: string) => {
    const stored = answers[questionId];
    const current: Record<string, string> = stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored as Record<string, string> }
      : Object.fromEntries(String(stored || "").split(";").map((pair) => pair.split("-").map((item) => item.trim())).filter((pair) => pair.length === 2));
    Object.keys(current).forEach((key) => { if (current[key] === rightKey) delete current[key]; });
    if (rightKey) current[leftKey] = rightKey;
    else delete current[leftKey];
    setAnswer(questionId, current);
  };
  const toggleReview = (questionId: string) => setReviewedIds((current) => current.includes(questionId) ? current.filter((item) => item !== questionId) : [...current, questionId]);
  const isAnswered = (question: PublicQuestion) => hasQuestionAnswer(question, answers[question.id]);
  const answerSummary = (question: PublicQuestion) => {
    const value = answers[question.id];
    if (!isAnswered(question)) return "Chưa trả lời";
    if (question.type === "single_choice" || question.type === "multiple_choice") {
      const keys = Array.isArray(value) ? value : [String(value)];
      return keys.map((key) => question.options?.find((option) => option.key === key)?.text || key).join("; ");
    }
    if (question.type === "ordering") {
      return String(value).split("-").map((key) => question.options?.find((option) => option.key === key)?.text || key).join(" → ");
    }
    if (question.type === "matching" && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value).map(([left, right]) => {
        const leftOption = question.options?.find((option) => option.key === left);
        const rightIndex = right.length === 1 ? right.toUpperCase().charCodeAt(0) - 65 : -1;
        const rightLabel = question.options?.[rightIndex]?.match_text;
        return (leftOption?.text || left) + " – " + (rightLabel || right);
      }).join("; ");
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [value.link, value.upload_url ? "Tệp: " + value.upload_url : ""].filter(Boolean).join(" · ");
    }
    return String(value);
  };

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
            <span className="border-l pl-3 text-sm font-bold text-slate-600">Training Completion Survey</span>
          </header>
          <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl shadow-blue-950/10">
            <div className="bg-gradient-to-br from-[#001e40] via-[#0049a8] to-[#00a77a] px-6 py-8 text-white sm:px-10">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Khảo sát kết thúc tập huấn</p>
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
                  {assessment.requires_participant && <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">{"Mã người tham gia *"}</span><input required className="ft-input" value={identity.participant_code} onChange={(event) => setIdentity({ ...identity, participant_code: event.target.value })} placeholder="VD: GV-001" /></label>}
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0"><p className="truncate text-sm font-extrabold">{assessment.title}</p><p className="text-xs text-slate-500">{attempt.variant} · {attempt.respondent_name}</p></div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-xs text-slate-500 sm:inline-flex"><Save className="h-3.5 w-3.5" />{saveState}</span>
            <button type="button" disabled={busy} onClick={() => void resetAttempt()} className="hidden rounded-lg border px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 sm:inline-flex" title="Xóa câu trả lời của lượt đang làm và bắt đầu lại"><RotateCcw className="mr-1 h-3.5 w-3.5" />Làm lại</button>
            <div aria-label={`Còn ${formatCountdown(secondsLeft)}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-black ${secondsLeft < 300 ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-800"}`}><Clock3 className="h-5 w-5" />{formatCountdown(secondsLeft)}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 px-3 py-4 sm:px-4 sm:py-6 md:grid-cols-[210px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border bg-white p-4 shadow-sm md:sticky md:top-24">
          <div className="flex items-center justify-between"><b>Danh sách câu</b><span className="text-xs text-slate-500">{currentIndex + 1}/{questions.length}</span></div>
          <div className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-10 md:grid-cols-4">{questions.map((question, index) => { const answered = isAnswered(question); const reviewed = reviewedIds.includes(question.id); return <button type="button" aria-label={`Câu ${index + 1}: ${answered ? "đã trả lời" : "chưa trả lời"}`} key={question.id} onClick={() => { setCurrentIndex(index); setReviewMode(false); }} className={`relative grid aspect-square place-items-center rounded-lg border text-xs font-black ${index === currentIndex && !reviewMode ? "border-blue-700 bg-blue-700 text-white ring-2 ring-blue-200" : answered ? "border-emerald-400 bg-emerald-100 text-emerald-900" : "border-blue-300 bg-blue-50 text-blue-800"}`}>{index + 1}{reviewed && <Bookmark className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-amber-400 text-amber-500" />}</button>; })}</div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-[11px] text-slate-500 md:block md:space-y-2"><p><span className="mr-2 inline-block h-2.5 w-2.5 rounded bg-emerald-200" />Đã trả lời</p><p><span className="mr-2 inline-block h-2.5 w-2.5 rounded bg-blue-100 ring-1 ring-blue-300" />Chưa trả lời</p><p><Bookmark className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-500" />Đánh dấu xem lại</p></div>
          <button type="button" disabled={busy} onClick={() => void resetAttempt()} className="mt-3 inline-flex items-center rounded-lg border px-3 py-2 text-xs font-bold text-slate-600 sm:hidden"><RotateCcw className="mr-1 h-3.5 w-3.5" />Làm lại lượt hiện tại</button>
        </aside>
        <section className="min-w-0">{message && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</div>}{reviewMode ? <article className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
            <div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Bước cuối</p><h1 className="mt-1 text-2xl font-extrabold">Rà soát toàn bộ câu trả lời</h1><p className="mt-2 text-sm text-slate-500">Bấm vào một câu để quay lại chỉnh sửa. Bài chỉ được khóa sau khi anh/chị xác nhận nộp.</p></div>
            <button type="button" onClick={() => setReviewMode(false)} className="ft-btn ft-btn-secondary"><ChevronLeft className="h-4 w-4" />Quay lại làm bài</button>
          </div>
          <div className="mt-5 grid gap-3">
            {questions.map((question, index) => <button type="button" key={question.id} onClick={() => { setCurrentIndex(index); setReviewMode(false); }} className={`rounded-xl border p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 ${isAnswered(question) ? "border-emerald-200" : "border-blue-200 bg-blue-50/50"}`}>
              <span className="flex items-start justify-between gap-3"><b className="text-sm text-slate-900">Câu {index + 1}. {question.text}</b><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${isAnswered(question) ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{isAnswered(question) ? "Đã trả lời" : "Chưa trả lời"}</span></span>
              <span className="mt-2 block break-words text-sm text-slate-600">{answerSummary(question)}</span>
              {reviewedIds.includes(question.id) && <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-700"><Bookmark className="h-3.5 w-3.5 fill-amber-400" />Đã đánh dấu xem lại</span>}
            </button>)}
          </div>
        </article> : currentQuestion && <article className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">{currentQuestion.question_code || `Câu ${currentIndex + 1}`}</p><div className="mt-2 flex flex-wrap gap-2">{currentQuestion.knowledge_type && <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">{currentQuestion.knowledge_type}</span>}{currentQuestion.category && <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{currentQuestion.category}</span>}{currentQuestion.difficulty && <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{currentQuestion.difficulty}</span>}</div></div><div className="flex items-center gap-3"><span className="text-xs font-semibold text-slate-500">{currentQuestion.points} điểm</span><button onClick={() => toggleReview(currentQuestion.id)} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold ${reviewedIds.includes(currentQuestion.id) ? "border-amber-300 bg-amber-50 text-amber-800" : "text-slate-600"}`}><Bookmark className={`h-4 w-4 ${reviewedIds.includes(currentQuestion.id) ? "fill-amber-400" : ""}`} />Xem lại</button></div></div>
          <h1 className="mt-5 text-lg font-bold leading-8">{currentQuestion.text}{currentQuestion.required && <span className="ml-1 text-rose-500">*</span>}</h1>
          {currentMedia?.kind === "image" && <img src={currentMedia.url} alt="" className="mt-5 max-h-[460px] w-full rounded-xl border object-contain" />}{currentMedia?.kind === "video" && <div className="mt-5 aspect-video overflow-hidden rounded-xl border bg-slate-950"><iframe src={currentMedia.url} title="Question media" className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>}{currentMedia?.kind === "link" && <a href={currentMedia.url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700"><PlayCircle className="h-4 w-4" />Mở tài liệu minh họa</a>}
          {currentQuestion.type === "single_choice" && <div className="mt-6 grid gap-3">{(currentQuestion.options || []).map((option) => <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${answers[currentQuestion.id] === option.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "hover:border-slate-400"}`}><input type="radio" name={currentQuestion.id} className="mt-1" checked={answers[currentQuestion.id] === option.key} onChange={() => setAnswer(currentQuestion.id, option.key)} /><b className="text-blue-800">{option.key}.</b><span>{option.text}</span></label>)}</div>}
          {currentQuestion.type === "multiple_choice" && <div className="mt-6 grid gap-3">{(currentQuestion.options || []).map((option) => { const checked = Array.isArray(answers[currentQuestion.id]) && (answers[currentQuestion.id] as string[]).includes(option.key); return <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${checked ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "hover:border-slate-400"}`}><input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleMultiple(currentQuestion.id, option.key)} /><b className="text-emerald-800">{option.key}.</b><span>{option.text}</span></label>; })}</div>}
          {currentQuestion.type === "short_answer" && <textarea rows={5} className="ft-input mt-6 resize-y" value={typeof answers[currentQuestion.id] === "string" ? answers[currentQuestion.id] as string : ""} onChange={(event) => setAnswer(currentQuestion.id, event.target.value)} placeholder="Nhập câu trả lời..." />}
          {currentQuestion.type === "matching" && (() => { const stored = answers[currentQuestion.id]; const matching: Record<string, string> = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, string> : Object.fromEntries(String(stored || "").split(";").map((pair) => pair.split("-").map((item) => item.trim())).filter((pair) => pair.length === 2)); const rightKeys = (currentQuestion.options || []).map((_, index) => String.fromCharCode(65 + index)); const rightLabels = Object.fromEntries((currentQuestion.options || []).map((item, index) => [String.fromCharCode(65 + index), item.match_text || ""])); const used = new Set(Object.values(matching)); return <div className="mt-6 rounded-xl border bg-slate-50 p-4"><p className="text-sm font-bold text-slate-700">Kéo các thẻ A, B, C... vào vế trái tương ứng</p><div className="mt-3 flex flex-wrap gap-2">{rightKeys.map((key) => <button type="button" key={key} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", key)} className={`flex min-h-10 min-w-10 cursor-grab items-center justify-center rounded-lg px-3 border-2 bg-white font-black text-blue-700 ${used.has(key) ? "opacity-40" : "border-blue-300"}`}>{key}{rightLabels[key] && <span className="ml-2 text-left text-xs font-semibold text-slate-700">{rightLabels[key]}</span>}</button>)}</div><div className="mt-4 space-y-2">{(currentQuestion.options || []).map((option) => <div key={option.key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setMatching(currentQuestion.id, option.key, event.dataTransfer.getData("text/plain")); }} className="grid gap-2 rounded-xl border-2 border-dashed bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(140px,220px)] sm:items-center"><span className="text-sm font-semibold">{option.text}</span><select aria-label={`Ghép ${option.key}`} className="rounded-lg border px-3 py-2 font-bold text-blue-700" value={matching[option.key] || ""} onChange={(event) => setMatching(currentQuestion.id, option.key, event.target.value)}><option value="">Thả vào đây</option>{rightKeys.map((key) => <option key={key} value={key}>{key}{rightLabels[key] ? ` – ${rightLabels[key]}` : ""}</option>)}</select></div>)}</div></div>; })()}
          {currentQuestion.type === "ordering" && (() => { const stored = typeof answers[currentQuestion.id] === "string" ? String(answers[currentQuestion.id]).split("-").filter(Boolean) : []; const order = stored.length === (currentQuestion.options || []).length ? stored : (currentQuestion.options || []).map((item) => item.key); const optionMap = Object.fromEntries((currentQuestion.options || []).map((item) => [item.key, item.text])); return <div className="mt-6 space-y-2"><p className="mb-3 text-sm font-bold text-slate-700">Kéo thả để sắp xếp, hoặc dùng nút mũi tên.</p>{order.map((key, index) => <div key={key} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", key)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderOrdering(currentQuestion, event.dataTransfer.getData("text/plain"), index); }} className="flex cursor-grab items-center gap-3 rounded-xl border bg-white p-3"><GripVertical className="h-5 w-5 text-slate-400" /><span className="grid h-7 w-7 place-items-center rounded bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span><span className="flex-1 text-sm">{optionMap[key]}</span><div className="flex gap-1"><button onClick={() => moveOrdering(currentQuestion, index, -1)} disabled={index === 0} className="rounded border px-2 py-1 text-xs disabled:opacity-30">↑</button><button onClick={() => moveOrdering(currentQuestion, index, 1)} disabled={index === order.length - 1} className="rounded border px-2 py-1 text-xs disabled:opacity-30">↓</button></div></div>)}</div>; })()}
          {(currentQuestion.type === "practical_submission" || currentQuestion.type === "file_upload") && (() => { const stored = answers[currentQuestion.id]; const practical = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, string> : { link: typeof stored === "string" ? stored : "" }; const imageOnly = currentQuestion.type === "practical_submission"; return <div className="mt-6 grid gap-4"><label><span className="mb-1 block text-sm font-bold">Link sản phẩm / thư mục Drive</span><div className="relative"><Link2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input type="url" className="ft-input pl-10" value={practical.link || ""} onChange={(event) => setAnswer(currentQuestion.id, { ...practical, link: event.target.value })} placeholder="https://drive.google.com/..." /></div></label><label onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("border-blue-500", "bg-blue-50"); }} onDragLeave={(event) => event.currentTarget.classList.remove("border-blue-500", "bg-blue-50")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("border-blue-500", "bg-blue-50"); void uploadFile(currentQuestion, event.dataTransfer.files?.[0]); }} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center transition hover:border-blue-400 hover:bg-blue-50"><FileUp className="h-8 w-8 text-blue-600" /><b className="mt-2">{practical.upload_id ? "Đã tải tệp minh chứng" : "Thả tệp vào đây hoặc bấm để chọn"}</b><span className="mt-1 text-xs text-slate-500">{imageOnly ? "JPG, PNG, WEBP - tối đa 5 MB" : "Ảnh, PDF, Word, Excel hoặc TXT - tối đa 10 MB"}</span><input type="file" accept={imageOnly ? "image/*" : "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"} className="hidden" onChange={(event) => void uploadFile(currentQuestion, event.target.files?.[0])} /></label>{practical.upload_url && <a href={practical.upload_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 underline">Xem tệp đã tải</a>}</div>; })()}
          <div className="mt-8 flex items-center justify-between border-t pt-5"><button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))} className="ft-btn ft-btn-secondary disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Câu trước</button><button disabled={currentIndex === questions.length - 1} onClick={() => setCurrentIndex((value) => Math.min(questions.length - 1, value + 1))} className="ft-btn ft-btn-secondary disabled:opacity-40">Câu sau<ChevronRight className="h-4 w-4" /></button></div>
        </article>}</section>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-white p-3 shadow-[0_-8px_24px_rgba(15,23,42,.08)] sm:p-4"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><p className="hidden text-sm text-slate-600 sm:block">{unansweredRequired ? `Còn ${unansweredRequired} câu bắt buộc chưa trả lời` : "Đã trả lời đủ các câu bắt buộc"}</p>{reviewMode ? <button disabled={busy || unansweredRequired > 0} onClick={async () => { const confirmed = await appDialog.confirm("Nộp bài ngay? Sau khi nộp anh/chị không thể sửa câu trả lời.", { title: "Xác nhận nộp bài", confirmText: "Nộp bài", tone: "warning" }); if (confirmed) void save(true); }} className="ft-primary ml-auto disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />Xác nhận nộp bài</button> : <button disabled={busy || unansweredRequired > 0} onClick={() => { void save(false); setReviewMode(true); }} className="ft-primary ml-auto disabled:cursor-not-allowed disabled:opacity-50"><ListChecks className="h-4 w-4" />Rà soát trước khi nộp</button>}</div></footer>
    </div>
  );
}
