import React, { useEffect, useState } from "react";
import { ArrowLeft, FileCheck2, GraduationCap, Loader2 } from "lucide-react";

import AccountMenu from "../AccountMenu";
import TrainingAssessmentsAdmin from "./TrainingAssessmentsAdmin";

export default function TrainingAssessmentWorkspace({
  onBackToWorkspace,
  onOpenDigitalTraining,
  onAccountClick,
  onLogout,
  userName,
  userRole,
  photoURL,
  idToken,
}: {
  onBackToWorkspace: () => void;
  onOpenDigitalTraining: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  idToken: string;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const headers = { Authorization: `Bearer ${idToken}` };
    Promise.all([
      fetch("/api/digital-training/sessions", { headers }),
      fetch("/api/digital-training/classes", { headers }),
    ])
      .then(async ([sessionResponse, classResponse]) => {
        if (!sessionResponse.ok || !classResponse.ok) {
          throw new Error("Không thể tải dữ liệu liên kết từ Đào tạo số.");
        }
        const [sessionData, classData] = await Promise.all([
          sessionResponse.json(),
          classResponse.json(),
        ]);
        if (active) {
          setSessions(sessionData);
          setClasses(classData);
        }
      })
      .catch((error) => active && setNotice(String(error?.message || error)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [idToken]);

  return (
    <div className="ft-module-shell flex min-h-screen bg-slate-50 font-sans">
      <aside className="ft-sidebar hidden w-[280px] shrink-0 flex-col lg:flex">
        <div className="p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-white p-4">
            <img src="/logo.png" alt="FermatTech" className="h-10 object-contain" />
            <div className="border-l pl-3">
              <b>Fermat</b>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">
                Khảo sát kết thúc tập huấn
              </p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-2 px-4 pt-4">
          <div className="ft-nav-item ft-nav-item-active flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-bold">
            <FileCheck2 className="h-4 w-4" />
            Khảo sát kết thúc tập huấn
          </div>
          <button
            onClick={onOpenDigitalTraining}
            className="ft-nav-item flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-bold"
          >
            <GraduationCap className="h-4 w-4" />
            Mở Đào tạo số
          </button>
        </nav>
        <div className="ft-sidebar-footer border-t p-4">
          <button
            onClick={onBackToWorkspace}
            className="ft-sidebar-back mb-3 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại Workspace
          </button>
          <AccountMenu
            userName={userName}
            userRole={userRole}
            photoURL={photoURL}
            isGuest={false}
            onAccountClick={onAccountClick}
            onLogout={onLogout}
            variant="sidebar"
          />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="border-b bg-white px-5 py-4 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Liên kết dữ liệu với Đào tạo số
              </p>
              <h1 className="mt-1 text-2xl font-extrabold text-[#001e40]">
                Khảo sát kết thúc tập huấn
              </h1>
            </div>
            <button onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary lg:hidden">
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          {notice && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {notice}
            </p>
          )}
          {loading ? (
            <div className="grid min-h-[50vh] place-items-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <TrainingAssessmentsAdmin
              idToken={idToken}
              sessions={sessions}
              classes={classes}
              isGuest={false}
            />
          )}
        </div>
      </main>
    </div>
  );
}
