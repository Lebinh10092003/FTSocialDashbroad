import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Eye, LoaderCircle, MessageSquareText, Send } from 'lucide-react';
import type { ExamPaper, PaperQuestion } from './ExamPapers';
import PaperWorkflowPanel from './PaperWorkflowPanel';

type Props = {
  paper: ExamPaper;
  idToken?: string | null;
  canManage: boolean;
  onPaperChange: (paper: ExamPaper) => void;
};

type ChatMessage = { role: 'user' | 'assistant'; text: string };

const optionLabel = (index: number) => String.fromCharCode(65 + index);

export default function PaperPreviewStudio({ paper, idToken, canManage, onPaperChange }: Props) {
  const questions = paper.questions || [];
  const [previewMode, setPreviewMode] = useState<'paper' | 'answers'>('paper');
  const [scope, setScope] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Chọn một câu rồi mô tả nội dung cần sửa. Tôi sẽ giữ nguyên các ràng buộc của ma trận.' },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scope && questions[0]?.id) setScope(questions[0].id);
  }, [questions, scope]);

  const selected = useMemo(() => questions.find((question) => question.id === scope), [questions, scope]);

  const send = async () => {
    const value = message.trim();
    if (!value || busy) return;
    setHistory((items) => [...items, { role: 'user', text: value }]);
    setMessage('');
    setBusy(true);
    try {
      const response = await fetch(`/api/examination/papers/${paper.id}/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: value, questionId: scope === 'all' ? '' : scope }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Không thể chỉnh sửa (mã ${response.status}).`);
      onPaperChange(body.paper);
      const changed = body.changedQuestionIds?.length ? ` Đã cập nhật ${body.changedQuestionIds.length} câu.` : '';
      setHistory((items) => [...items, { role: 'assistant', text: `${body.reply || 'Đã xử lý yêu cầu.'}${changed}` }]);
    } catch (error: any) {
      setHistory((items) => [...items, { role: 'assistant', text: error.message || 'Không thể xử lý yêu cầu.' }]);
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(React.Fragment, null, React.createElement(PaperWorkflowPanel, { idToken, paper, onChange:onPaperChange, onNotice:(text:string)=>window.alert(text) }), (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-extrabold text-[#001e40]"><Eye className="h-5 w-5 text-[#1f4fc9]" />Xem thử trước khi xuất</h2>
          <p className="mt-1 text-xs text-slate-500">Xem thử và xuất Word không gọi AI, không phát sinh token. Chỉ nút Gửi trong khung chat mới dùng AI.</p>
        </div>
        <div className="flex rounded-lg border bg-slate-50 p-1 text-sm font-bold">
          <button onClick={() => setPreviewMode('paper')} className={`rounded-md px-3 py-1.5 ${previewMode === 'paper' ? 'bg-white text-[#1f4fc9] shadow-sm' : 'text-slate-500'}`}>Đề thi</button>
          <button onClick={() => setPreviewMode('answers')} className={`rounded-md px-3 py-1.5 ${previewMode === 'answers' ? 'bg-white text-[#1f4fc9] shadow-sm' : 'text-slate-500'}`}>Đáp án</button>
        </div>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-x-auto p-4 sm:p-6">
          <article className="mx-auto min-h-[1056px] min-w-[680px] max-w-[816px] bg-white px-[9%] py-[7%] font-serif text-[15px] leading-relaxed text-slate-950 shadow-lg">
            <header className="text-center">
              <p className="font-bold uppercase">{paper.competitionName || 'Cuộc thi'}</p>
              <h3 className="mt-1 text-xl font-bold uppercase">{previewMode === 'answers' ? 'Đáp án' : 'Đề thi'} {paper.sessionName}</h3>
              <p className="font-bold">{paper.subject} · {paper.gradeOrCategory}</p>
              <p className="mt-1 italic">Thời gian làm bài: {paper.durationMinutes} phút</p>
            </header>
            {previewMode === 'paper' ? (
              <>
                <div className="mt-5 grid grid-cols-2 border border-slate-800 text-sm">
                  <p className="border-b border-r border-slate-800 p-2">Họ và tên: ........................................</p>
                  <p className="border-b border-slate-800 p-2">Số báo danh: ........................</p>
                  <p className="border-r border-slate-800 p-2">Trường: .............................................</p>
                  <p className="p-2">Lớp: ........................</p>
                </div>
                <p className="my-4 text-sm"><b>Hướng dẫn:</b> Chọn một đáp án đúng cho mỗi câu trắc nghiệm; ghi đáp số vào ô trống đối với câu điền đáp số.</p>
                <div className="space-y-4">
                  {questions.map((question) => <PreviewQuestion key={question.id || question.order} question={question} selected={question.id === scope} onSelect={() => question.id && setScope(question.id)} />)}
                </div>
              </>
            ) : (
              <div className="mt-6">
                <div className="grid grid-cols-4 border-l border-t border-slate-800 sm:grid-cols-8">
                  {questions.map((question) => <div key={question.id || question.order} className="border-b border-r border-slate-800 text-center"><b className="block bg-blue-50 p-1">Câu {question.order}</b><span className="block p-2 font-bold">{question.correctAnswer}</span></div>)}
                </div>
                {questions.some((question) => question.explanation) && <h4 className="mt-7 font-bold">HƯỚNG DẪN GIẢI</h4>}
                {questions.filter((question) => question.explanation).map((question) => <p key={question.id || question.order} className="mt-3 text-justify"><b>Câu {question.order}.</b> {question.explanation}</p>)}
              </div>
            )}
          </article>
        </div>
        <aside className="flex min-h-[640px] flex-col border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
          <div className="border-b p-4">
            <h3 className="flex items-center gap-2 font-extrabold text-[#001e40]"><MessageSquareText className="h-5 w-5 text-[#1f4fc9]" />Chat chỉnh sửa đề</h3>
            <label className="mt-3 block text-xs font-bold text-slate-600">Phạm vi chỉnh sửa
              <select value={scope} onChange={(event) => setScope(event.target.value)} className="ft-input mt-1">
                {questions.map((question) => <option key={question.id || question.order} value={question.id || ''}>Câu {question.order} · {question.topic || 'Chưa có chủ đề'}</option>)}
                <option value="all">Toàn bộ đề (dùng nhiều token hơn)</option>
              </select>
            </label>
            {selected && <p className="mt-2 line-clamp-2 text-xs text-slate-500">Đang chọn: {selected.content}</p>}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {history.map((item, index) => <div key={index} className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${item.role === 'user' ? 'ml-auto bg-[#1f4fc9] text-white' : 'bg-slate-100 text-slate-700'}`}>{item.role === 'assistant' && <Bot className="mr-1 inline h-4 w-4" />}{item.text}</div>)}
            {busy && <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-500"><LoaderCircle className="mr-1 inline h-4 w-4 animate-spin" />Đang chỉnh sửa và kiểm tra ràng buộc...</div>}
          </div>
          <div className="border-t p-4">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} disabled={!canManage || busy} className="ft-input min-h-24" placeholder="Ví dụ: Sửa câu dẫn cho rõ hơn, giữ nguyên đáp án và độ khó..." />
            <button onClick={send} disabled={!canManage || busy || !message.trim() || !questions.length} className="ft-primary mt-2 w-full justify-center disabled:opacity-50"><Send className="h-4 w-4" />Gửi yêu cầu chỉnh sửa</button>
          </div>
        </aside>
      </div>
    </section>
  ));
}

function PreviewQuestion({ question, selected, onSelect }: { question: PaperQuestion; selected: boolean; onSelect: () => void }) {
  return <section onClick={onSelect} className={`cursor-pointer rounded-md border-l-4 px-3 py-1 transition ${selected ? 'border-[#1f4fc9] bg-blue-50/60' : 'border-transparent hover:bg-slate-50'}`}>
    <p className="whitespace-pre-line text-justify"><b>Câu {question.order}.</b> {question.content}</p>
    {question.questionType === 'numeric_input' ? <p className="ml-6 mt-2">Đáp số: ................................................</p> : <div className="ml-6 mt-1 space-y-0.5">{question.choices.map((choice, index) => <p key={index}><b>{optionLabel(index)}.</b> {choice}</p>)}</div>}
  </section>;
}
