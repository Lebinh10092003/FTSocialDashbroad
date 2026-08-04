import React, { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { appDialog } from './components/AppDialog';
import { BadgeDollarSign, CalendarCheck, ChartColumnBig, ClipboardList, FileCheck2, GraduationCap, Mail, QrCode, ShieldUser } from 'lucide-react';

import { Channel, UserRole } from './types';
import Sidebar from './components/social-dashboard/Sidebar';
import LoginModal from './components/LoginModal';
import AccountProfileModal from './components/AccountProfileModal';
import AccountMenu from './components/AccountMenu';

const lazyWithRecovery = <T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>) => lazy(async () => {
  const retryKey = `ft-workspace-lazy-reload:${window.location.pathname}`;
  try {
    const module = await loader();
    sessionStorage.removeItem(retryKey);
    return module;
  } catch (error) {
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
      return new Promise<never>(() => {});
    }
    sessionStorage.removeItem(retryKey);
    throw error;
  }
});

const Dashboard = lazyWithRecovery(() => import('./components/social-dashboard/Dashboard'));
const MediaSummary = lazyWithRecovery(() => import('./components/social-dashboard/MediaSummary'));
const Posts = lazyWithRecovery(() => import('./components/social-dashboard/Posts'));
const Sync = lazyWithRecovery(() => import('./components/social-dashboard/Sync'));
const Config = lazyWithRecovery(() => import('./components/social-dashboard/Config'));
const AccountManagement = lazyWithRecovery(() => import('./components/social-dashboard/AccountManagement'));
const EmailTemplateBuilder = lazyWithRecovery(() => import('./components/email-builder/EmailTemplateBuilder'));
const FinanceWorkspace = lazyWithRecovery(() => import('./components/digital-training/FinanceWorkspace'));
const ExaminationModule = lazyWithRecovery(() => import('./components/ExaminationModule'));
const DigitalTraining = lazyWithRecovery(() => import('./components/digital-training/DigitalTraining'));
const TrainingAssessmentPublic = lazyWithRecovery(() => import('./components/digital-training/TrainingAssessmentPublic'));
const TrainingAssessmentWorkspace = lazyWithRecovery(() => import('./components/digital-training/TrainingAssessmentWorkspace'));
const QRCodeGenerator = lazyWithRecovery(() => import('./components/QRCodeGenerator'));
const Attendance = lazyWithRecovery(() => import('./components/Attendance'));

type ViewMode = 'workspace' | 'social-dashboard' | 'email-builder' | 'examination' | 'digital-training' | 'finance-report' | 'training-assessments' | 'training-assessment-public' | 'qr-generator' | 'attendance' | 'account-management';

const SOCIAL_TABS = ['dashboard', 'media', 'posts', 'sync', 'config'] as const;
type SocialTab = typeof SOCIAL_TABS[number];
const socialTabFromPath = (pathname: string): SocialTab => {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/')[1] || 'dashboard';
  return (SOCIAL_TABS as readonly string[]).includes(segment) ? segment as SocialTab : 'dashboard';
};
const socialPathFor = (tab: string) => tab === 'dashboard' ? '/social-dashboard' : `/social-dashboard/${tab}`;

type AppUser = {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  accessModules?: string[];
  jobTitle?: { id: number; name: string } | null;
  departments?: { id: number; name: string }[];
};

type StoredSession = {
  token: string;
  user: AppUser;
  role: UserRole;
};

const GUEST_USER: AppUser = {
  uid: 'guest',
  email: 'guest@ftsocial.com',
  displayName: 'Khách',
  photoURL: '',
};

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.email) return null;
    return {
      token: String(parsed.token),
      user: parsed.user as AppUser,
      role: (parsed.role || 'EMPLOYEE') as UserRole,
    };
  } catch {
    return null;
  }
}

function userFromApi(value: any): AppUser {
  return {
    uid: String(value?.uid || value?.email || ''),
    email: String(value?.email || ''),
    displayName: String(value?.displayName || value?.name || value?.email || 'Người dùng'),
    photoURL: value?.photoURL || value?.picture || '',
    accessModules: Array.isArray(value?.accessModules) ? value.accessModules : [],
    jobTitle: value?.jobTitle || null,
    departments: Array.isArray(value?.departments) ? value.departments : value?.department ? [value.department] : [],
  };
}

function getInitialViewMode(): ViewMode {
  const path = window.location.pathname;
  if (path.startsWith('/training-assessment/')) return 'training-assessment-public';
  if (path.startsWith('/training-assessments')) return 'training-assessments';
  if (path.startsWith('/digital-training')) return 'digital-training';
  if (path.startsWith('/social-dashboard')) return 'social-dashboard';
  if (path.startsWith('/finance-report')) return 'finance-report';
  if (path.startsWith('/email-builder')) return 'email-builder';
  if (path.startsWith('/examination')) return 'examination';
  if (path.startsWith('/qr-generator')) return 'qr-generator';
  if (path.startsWith('/attendance')) return 'attendance';
  if (path.startsWith('/account-management')) return 'account-management';
  return 'workspace';
}

class ExaminationErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-800">
          <div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-extrabold text-rose-700">Không thể tải mô-đun Khảo thí</h1>
            <p className="mt-2 text-sm text-slate-600">Hệ thống đã chặn lỗi để không hiển thị màn hình trắng.</p>
            <pre className="mt-4 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-rose-200">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
            >
              Thử tải lại mô-đun
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const initialSession = useMemo(readStoredSession, []);
  const [user, setUser] = useState<AppUser>(initialSession?.user || GUEST_USER);
  const [idToken, setIdToken] = useState<string | null>(initialSession?.token || null);
  const [userRole, setUserRole] = useState<UserRole>(initialSession?.role || 'EMPLOYEE');
  const [authChecking, setAuthChecking] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [accessNotice, setAccessNotice] = useState('');

  const [viewMode, setViewModeState] = useState<ViewMode>(getInitialViewMode());
  const [activeTab, setActiveTab] = useState<SocialTab>(() => socialTabFromPath(window.location.pathname));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  const isGuest = !idToken || user.email === GUEST_USER.email;
  const normalisedEmployeeIdentity = [user.jobTitle?.name || '', ...(user.departments || []).map(item => item.name)]
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(new RegExp(String.fromCharCode(273), 'g'), 'd').toLocaleLowerCase('vi-VN');
  const isAccountant = normalisedEmployeeIdentity.includes('ke toan');
  const canViewFinance = !isGuest && (userRole === 'ADMIN' || userRole === 'MANAGER' || isAccountant || normalisedEmployeeIdentity.includes('giam doc') || normalisedEmployeeIdentity.includes('quan ly'));
  const canEditFinance = !isGuest && (userRole === 'ADMIN' || isAccountant);
  const moduleForView: Partial<Record<ViewMode, string>> = { 'social-dashboard': 'social-dashboard', 'email-builder': 'email-builder', examination: 'examination', 'digital-training': 'digital-training', 'training-assessments': 'digital-training' };
  const canAccessView = (mode: ViewMode) => { if (mode === 'qr-generator') return true; if (mode === 'attendance') return !isGuest; if (mode === 'training-assessments') return !isGuest && (userRole === 'ADMIN' || (user.accessModules || []).includes('digital-training')); if (mode === 'account-management') return userRole === 'ADMIN'; if (mode === 'finance-report') return canViewFinance; if (isGuest) return !!moduleForView[mode]; return userRole === 'ADMIN' || (!!moduleForView[mode] && (user.accessModules || []).includes(moduleForView[mode]!)); };
  const googleAccessToken = null;

  const persistSession = (token: string, nextUser: AppUser, role: UserRole) => {
    localStorage.setItem('ft_auth_session', JSON.stringify({ token, user: nextUser, role }));
  };

  const clearSession = () => {
    localStorage.removeItem('ft_auth_session');
    localStorage.removeItem('google_access_token');
  };

  useEffect(() => {
    let active = true;
    const validateSession = async () => {
      if (!idToken) {
        if (active) setAuthChecking(false);
        return;
      }
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) throw new Error('Phiên đăng nhập không còn hiệu lực.');
        const profile = await response.json();
        if (!active) return;
        const nextUser = userFromApi(profile);
        const nextRole = (profile.role || 'EMPLOYEE') as UserRole;
        setUser(nextUser);
        setUserRole(nextRole);
        persistSession(idToken, nextUser, nextRole);
      } catch {
        if (!active) return;
        clearSession();
        setIdToken(null);
        setUser(GUEST_USER);
        setUserRole('EMPLOYEE');
        setViewModeState('workspace');
      } finally {
        if (active) setAuthChecking(false);
      }
    };
    validateSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const nextMode = getInitialViewMode();
      setViewModeState(nextMode);
      if (nextMode === 'social-dashboard') setActiveTab(socialTabFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    const path = mode === 'workspace' ? '/' : `/${mode}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  const setSocialTab = (tab: string) => {
    const requestedTab = (SOCIAL_TABS as readonly string[]).includes(tab) ? tab as SocialTab : 'dashboard';
    const nextTab = isGuest && (requestedTab === 'sync' || requestedTab === 'config') ? 'dashboard' : requestedTab;
    setActiveTab(nextTab);
    setViewModeState('social-dashboard');
    const path = socialPathFor(nextTab);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  useEffect(() => {
    if (authChecking || viewMode === 'workspace' || viewMode === 'training-assessment-public' || viewMode === 'qr-generator') return;
    if (!canAccessView(viewMode)) {
      setViewModeState('workspace');
      window.history.replaceState(null, '', '/');
      if (isGuest) {
        setAuthError('Vui lòng đăng nhập để truy cập mô-đun.');
        setShowLoginModal(true);
      } else {
        setAccessNotice('Tài khoản của bạn chưa được cấp quyền truy cập mô-đun này.');
      }
      return;
    }
    if (viewMode === 'social-dashboard' && isGuest && (activeTab === 'sync' || activeTab === 'config')) {
      setActiveTab('dashboard');
      window.history.replaceState(null, '', socialPathFor('dashboard'));
    }
  }, [activeTab, authChecking, canViewFinance, isGuest, user.accessModules, userRole, viewMode]);

  const openProtectedView = (mode: ViewMode, tab?: string) => {
    if (!canAccessView(mode)) {
      if (isGuest) { setAuthError('Vui lòng đăng nhập để truy cập mô-đun.'); setShowLoginModal(true); }
      else setAccessNotice('Tài khoản của bạn chưa được cấp quyền truy cập mô-đun này.');
      return;
    }
    if (mode === 'social-dashboard' && tab) { setSocialTab(tab); return; }
    setViewMode(mode);
  };
  const handleCredentialsAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Đăng nhập thất bại.');

      const token = String(body.token || '');
      const nextUser = userFromApi(body.user);
      const nextRole = (body.user?.role || 'EMPLOYEE') as UserRole;
      if (!token || !nextUser.email) throw new Error('Máy chủ trả về phiên đăng nhập không hợp lệ.');

      setIdToken(token);
      setUser(nextUser);
      setUserRole(nextRole);
      persistSession(token, nextUser, nextRole);
      setLoginPassword('');
      setShowLoginModal(false);
    } catch (error: any) {
      setAuthError(error.message || 'Đăng nhập thất bại.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const token = idToken;
    clearSession();
    setIdToken(null);
    setUser(GUEST_USER);
    setUserRole('EMPLOYEE');
    setChannels([]);
    setViewMode('workspace');
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  };

  const handleConnectGoogle = async () => {
    void appDialog.alert('Tính năng kết nối Google Sheets hiện chưa sẵn sàng.', { title: 'Kết nối Google Sheets', tone: 'info' });
    return false;
  };

  const handleRefreshChannels = async () => {
    if (!canAccessView('social-dashboard')) { setChannels([]); return; }
    const headers: HeadersInit = {};
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }
    const response = await fetch('/api/channels', { headers });
    if (response.status === 401) {
      if (idToken) {
        await handleLogout();
      }
      return;
    }
    if (!response.ok) throw new Error('Không thể tải danh sách kênh.');
    const list = await response.json();
    setChannels(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    setLoading(true);
    handleRefreshChannels()
      .catch(error => console.error('Lỗi lấy danh sách kênh:', error))
      .finally(() => setLoading(false));
  }, [idToken]);

  const openAccount = () => {
    if (isGuest) { setAuthError(''); setShowLoginModal(true); return; }
    setShowProfile(true);
  };

  const handleProfileSaved = (nextUser: AppUser) => {
    setUser(nextUser);
    if (idToken) persistSession(idToken, nextUser, userRole);
  };

  const handlePasswordChanged = (nextToken: string, nextUser: AppUser) => {
    setIdToken(nextToken);
    setUser(nextUser);
    persistSession(nextToken, nextUser, userRole);
  };
  const loginModal = (
    <LoginModal
      open={showLoginModal}
      onClose={() => setShowLoginModal(false)}
      onSubmit={handleCredentialsAuth}
      email={loginEmail}
      password={loginPassword}
      setEmail={setLoginEmail}
      setPassword={setLoginPassword}
      loading={authLoading}
      error={authError}
    />
  );

  const profileModal = (
    <AccountProfileModal open={showProfile} user={user} idToken={idToken} onClose={() => setShowProfile(false)} onSaved={handleProfileSaved} onTokenChanged={handlePasswordChanged}/>
  );
  if (authChecking) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-violet-600 shadow-lg animate-pulse" />
          <p className="text-sm font-semibold text-slate-500">Đang kiểm tra phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  if (viewMode === 'workspace') {
    const apps: Array<{ mode: ViewMode; title: string; description: string; gradient: string; icon: React.ElementType }> = [
      {
        mode: 'examination',
        title: 'Khảo thí',
        description: 'Quản lý cuộc thi, kỳ tổ chức, thí sinh và nguồn dữ liệu Google Sheets.',
        gradient: 'from-[#00C68D] to-[#008f68]',
        icon: ClipboardList,
      },
      {
        mode: 'digital-training',
        title: 'Đào tạo số',
        description: 'Quản lý nội dung đào tạo chuyển đổi số và ứng dụng AI.',
        gradient: 'from-[#0055DA] to-[#00C68D]',
        icon: GraduationCap,
      },
      {
        mode: 'social-dashboard',
        title: 'Truyền thông',
        description: 'Theo dõi Facebook, Zalo OA, báo cáo tương tác và đồng bộ dữ liệu.',
        gradient: 'from-[#0055DA] to-[#0042AD]',
        icon: ChartColumnBig,
      },
      {
        mode: 'attendance',
        title: 'Công ca',
        description: 'Ghi nhận giờ vào, giờ ra và theo dõi dữ liệu công ca theo tháng.',
        gradient: 'from-[#173F30] to-[#4E9B73]',
        icon: CalendarCheck,
      },
      {
        mode: 'email-builder',
        title: 'Trình tạo Email',
        description: 'Thiết kế email trực quan và lưu mẫu dùng chung.',
        gradient: 'from-[#FF0052] to-[#d90045]',
        icon: Mail,
      },
      {
        mode: 'qr-generator',
        title: 'Trình tạo mã QR',
        description: 'Tạo QR đi thẳng tới form khảo sát, tài liệu hoặc bất kỳ đường dẫn nào.',
        gradient: 'from-[#102A43] to-[#DE6B35]',
        icon: QrCode,
      },
      {
        mode: 'training-assessments',
        title: 'Khảo sát kết thúc tập huấn',
        description: 'Chia mã đề cân bằng, đặt thời gian, chấm điểm và theo dõi kết quả tập huấn.',
        gradient: 'from-[#001E40] to-[#0055DA]',
        icon: FileCheck2,
      },
    ];
    if (userRole === 'ADMIN') {
      apps.push({
        mode: 'account-management',
        title: 'Quản lý nhân viên',
        description: 'Tạo, phân quyền và quản lý thành viên Workspace.',
        gradient: 'from-[#101114] to-[#0055DA]',
        icon: ShieldUser,
      });
    }

    if (canViewFinance) {
      apps.push({
        mode: 'finance-report',
        title: 'Báo cáo thu chi',
        description: 'Theo dõi tổng thu, tổng chi, công nợ, chứng từ và tình trạng xử lý tài chính.',
        gradient: 'from-[#0F766E] to-[#0055DA]',
        icon: BadgeDollarSign,
      });
    }

    const visibleApps = apps.filter(app => app.mode === 'attendance' || canAccessView(app.mode));
    return (
      <div className="min-h-dvh liquid-bg flex flex-col font-sans relative overflow-x-hidden">
        <header className="sticky top-0 z-30 w-full glass-panel border-b border-white/50">
          <div className="relative mx-auto flex max-w-[1600px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex shrink-0 items-center">
              <img src="/logo.png" alt="FermatTech Logo" className="h-8 object-contain" />
            </div>
            <div className="pointer-events-none absolute left-1/2 max-w-[48vw] -translate-x-1/2 truncate whitespace-nowrap text-center">
              <h1 className="text-sm font-extrabold tracking-tight text-slate-900 sm:text-lg lg:text-2xl">
                Không gian làm việc <span className="ft-gradient-text">FermatTech Workspace</span>
              </h1>
            </div>
            <AccountMenu
              userName={user.displayName}
              userRole={userRole}
              photoURL={user.photoURL}
              isGuest={isGuest}
              onAccountClick={openAccount}
              onLogin={() => { setAuthError(''); setShowLoginModal(true); }}
              onLogout={handleLogout}
              variant="header"
            />
          </div>
        </header>

        <main className="z-10 mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {accessNotice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:col-span-2 lg:col-span-3">{accessNotice}</div>}
            {visibleApps.map(app => {
              const AppIcon = app.icon;
              return (
                <button
                  key={app.mode}
                  type="button"
                  onClick={() => openProtectedView(app.mode, app.mode === 'social-dashboard' ? 'dashboard' : undefined)}
                  className="glass-card p-7 rounded-3xl text-left group min-h-[210px] flex flex-col justify-between"
                >
                  <div>
                    <div className={`grid w-14 h-14 place-items-center rounded-2xl bg-gradient-to-tr ${app.gradient} shadow-lg mb-5`}><AppIcon className="h-7 w-7 text-white" /></div>
                    <h3 className="ft-heading ft-heading-sm">{app.title}</h3>
                    <p className="ft-body-sm text-slate-500 mt-2 leading-relaxed">{app.description}</p>
                  </div>
                  <span className="pt-5 text-sm font-semibold text-amber-600">{'Truy cập ứng dụng →'}</span>
                </button>
              );
            })}
          </div>
        </main>
        {loginModal}{profileModal}
      </div>
    );
  }

  if (viewMode === 'finance-report' && !canAccessView('finance-report')) return null;

  if (viewMode === 'finance-report') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Báo cáo thu chi...</div>}>
          <FinanceWorkspace
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            idToken={idToken || ''}
            canEdit={canEditFinance}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'account-management') {
    if (userRole !== 'ADMIN') return null;
    return (
      <>
        <div className="min-h-screen bg-slate-50 font-sans">
          <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8"><button onClick={() => setViewMode('workspace')} className="ft-btn ft-btn-secondary">Quay lại Workspace</button><span className="text-sm font-bold text-slate-700">Quản trị Workspace</span></div></header>
          <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><Suspense fallback={<div className="py-16 text-center text-sm text-slate-500">Đang tải quản lý nhân viên...</div>}><AccountManagement idToken={idToken || ''} userRole={userRole} /></Suspense></main>
        </div>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'training-assessment-public') {
    const slug = window.location.pathname.replace(/^\/training-assessment\//, '').split('/')[0];
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50">Đang mở bài đánh giá...</div>}>
        <TrainingAssessmentPublic slug={slug} />
      </Suspense>
    );
  }

  if (viewMode === 'training-assessments' && !canAccessView('training-assessments')) return null;

  if (viewMode === 'training-assessments') {
    return (
      <>
        <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50">Đang mở Khảo sát kết thúc tập huấn...</div>}>
          <TrainingAssessmentWorkspace
            onBackToWorkspace={() => setViewMode('workspace')}
            onOpenDigitalTraining={() => setViewMode('digital-training')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            idToken={idToken || ''}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'qr-generator') {
    return (
      <Suspense fallback={<div className="grid h-screen place-items-center bg-[#f7f4ee]">Đang nạp Trình tạo mã QR...</div>}>
        <QRCodeGenerator onBackToWorkspace={() => setViewMode('workspace')} />
      </Suspense>
    );
  }

  if (viewMode === 'attendance' && isGuest) return null;

  if (viewMode === 'attendance') {
    return (
      <Suspense fallback={<div className="grid h-screen place-items-center bg-[#f3f5f1]">Đang nạp mô-đun Công ca...</div>}>
        <Attendance onBackToWorkspace={() => setViewMode('workspace')} idToken={idToken || ''} userName={user.displayName} />
      </Suspense>
    );
  }

  if (viewMode === 'email-builder' && !canAccessView('email-builder')) return null;

  if (viewMode === 'email-builder') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Trình tạo Email...</div>}>
          <EmailTemplateBuilder
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            userEmail={user.email}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'digital-training' && !canAccessView('digital-training')) return null;

  if (viewMode === 'digital-training') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Đào tạo số...</div>}>
          <DigitalTraining
            onBackToWorkspace={() => setViewMode('workspace')}
            onOpenTrainingAssessment={() => setViewMode('training-assessments')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            jobTitle={user.jobTitle?.name}
            departmentNames={(user.departments || []).map((item) => item.name)}
            idToken={idToken || ''}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'examination' && !canAccessView('examination')) return null;

  if (viewMode === 'examination') {
    return (
      <>
        <ExaminationErrorBoundary>
          <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Khảo thí...</div>}>
            <ExaminationModule
              onBackToWorkspace={() => setViewMode('workspace')}
              userName={user.displayName}
              userEmail={user.email}
              photoURL={user.photoURL}
              idToken={idToken}
              googleAccessToken={googleAccessToken}
              userRole={userRole}
              isGuest={isGuest}
              onAccountClick={openAccount}
              onLogout={handleLogout}
            />
          </Suspense>
        </ExaminationErrorBoundary>
        {loginModal}{profileModal}
      </>
    );
  }

  if (!canAccessView('social-dashboard')) return null;
  if (isGuest && (activeTab === 'sync' || activeTab === 'config')) return null;

  return (
    <div className="ft-module-shell flex h-screen overflow-hidden font-sans">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setSocialTab}
        user={user}
        userRole={userRole}
        idToken={idToken || ''}
        onLogout={handleLogout}
        onLogin={() => { setAuthError(''); setShowLoginModal(true); }}
        onAccountClick={openAccount}
        onBackToWorkspace={() => setViewMode('workspace')}
      />
      <main className="flex-1 overflow-y-auto"><div className="ft-module-content px-5 py-6 md:px-7 md:py-7">
        {loading ? (
          <div className="grid h-full place-items-center text-sm font-semibold text-slate-500">Đang tải dữ liệu...</div>
        ) : (
          <div className="max-w-[1600px] mx-auto">
            <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-slate-500">Đang tải mô-đun...</div>}>
              {activeTab === 'dashboard' && (
                <Dashboard idToken={idToken || ''} googleAccessToken={googleAccessToken} channels={channels} onOpenConfig={() => setActiveTab('config')} />
              )}
              {activeTab === 'media' && <MediaSummary idToken={idToken || ''} channels={channels} />}
              {activeTab === 'posts' && <Posts idToken={idToken || ''} channels={channels} />}
              {activeTab === 'sync' && (
                <Sync
                  idToken={idToken || ''}
                  googleAccessToken={googleAccessToken}
                  channels={channels}
                  userRole={userRole}
                  onRefreshChannels={handleRefreshChannels}
                  onConnectGoogle={handleConnectGoogle}
                />
              )}
              {activeTab === 'config' && (
                <Config
                  idToken={idToken || ''}
                  googleAccessToken={googleAccessToken}
                  userRole={userRole}
                  onConnectGoogle={handleConnectGoogle}
                  showUserManagement={false}
                  onChannelsChanged={handleRefreshChannels}
                />
              )}
            </Suspense>
          </div>
        )}
      </div>
      </main>
      {loginModal}{profileModal}
    </div>
  );
}
