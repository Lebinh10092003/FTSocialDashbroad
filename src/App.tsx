import React, { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ChartColumnBig, ClipboardList, GraduationCap, LogIn, LogOut, Mail, ShieldUser } from 'lucide-react';

import { Channel, UserRole } from './types';
import Sidebar from './components/social-dashboard/Sidebar';
import LoginModal from './components/LoginModal';

const Dashboard = lazy(() => import('./components/social-dashboard/Dashboard'));
const MediaSummary = lazy(() => import('./components/social-dashboard/MediaSummary'));
const Posts = lazy(() => import('./components/social-dashboard/Posts'));
const Sync = lazy(() => import('./components/social-dashboard/Sync'));
const Config = lazy(() => import('./components/social-dashboard/Config'));
const AccountManagement = lazy(() => import('./components/social-dashboard/AccountManagement'));
const EmailTemplateBuilder = lazy(() => import('./components/email-builder/EmailTemplateBuilder'));
const ExaminationModule = lazy(() => import('./components/ExaminationModule'));
const DigitalTraining = lazy(() => import('./components/digital-training/DigitalTraining'));

type ViewMode = 'workspace' | 'social-dashboard' | 'email-builder' | 'examination' | 'digital-training' | 'account-management';

type AppUser = {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
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
  };
}

function getInitialViewMode(): ViewMode {
  const path = window.location.pathname;
  if (path.startsWith('/digital-training')) return 'digital-training';
  if (path.startsWith('/social-dashboard')) return 'social-dashboard';
  if (path.startsWith('/email-builder')) return 'email-builder';
  if (path.startsWith('/examination')) return 'examination';
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

  const [viewMode, setViewModeState] = useState<ViewMode>(getInitialViewMode());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  const isGuest = !idToken || user.email === GUEST_USER.email;
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
      setViewModeState(getInitialViewMode());
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    const path = mode === 'workspace' ? '/' : `/${mode}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  const openProtectedView = (mode: ViewMode, tab?: string) => {
    if (tab) setActiveTab(tab);
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
    alert('Tính năng kết nối Google Sheets hiện chưa sẵn sàng.');
    return false;
  };

  const handleRefreshChannels = async () => {
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
        mode: 'social-dashboard',
        title: 'Phân tích Mạng xã hội',
        description: 'Theo dõi Facebook, Zalo OA, báo cáo tương tác và đồng bộ dữ liệu.',
        gradient: 'from-blue-500 to-indigo-600',
        icon: ChartColumnBig,
      },
      {
        mode: 'email-builder',
        title: 'Trình tạo Email',
        description: 'Thiết kế email trực quan và lưu mẫu dùng chung.',
        gradient: 'from-indigo-500 to-violet-600',
        icon: Mail,
      },
      {
        mode: 'examination',
        title: 'Khảo thí',
        description: 'Quản lý cuộc thi, kỳ tổ chức, thí sinh và nguồn dữ liệu Google Sheets.',
        gradient: 'from-emerald-500 to-teal-600',
        icon: ClipboardList,
      },
      {
        mode: 'digital-training',
        title: 'Đào tạo số',
        description: 'Quản lý nội dung đào tạo chuyển đổi số và ứng dụng AI.',
        gradient: 'from-cyan-500 to-blue-600',
        icon: GraduationCap,
      },
    ];
    if (userRole === 'ADMIN') {
      apps.push({
        mode: 'account-management',
        title: 'Quản lý tài khoản',
        description: 'Tạo, phân quyền và quản lý thành viên Workspace.',
        gradient: 'from-slate-600 to-blue-700',
        icon: ShieldUser,
      });
    }

    return (
      <div className="min-h-dvh liquid-bg flex flex-col font-sans relative overflow-x-hidden">
        <header className="sticky top-0 z-30 w-full glass-panel border-b border-white/50">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3.5">
              <img src="/logo.png" alt="FermatTech Logo" className="h-8 object-contain" />
              <div className="hidden sm:block border-l border-slate-200 pl-3.5">
                <h1 className="font-extrabold text-slate-900 text-sm">Fermat Workspace</h1>
              </div>
            </div>
            {isGuest ? (
              <button onClick={() => { setAuthError(''); setShowLoginModal(true); }} className="ft-btn ft-btn-primary">
                <LogIn className="w-4 h-4" /> Đăng nhập
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="hidden sm:block text-xs font-semibold text-slate-600">{user.displayName}</span>
                <button onClick={handleLogout} className="ft-btn ft-btn-secondary text-rose-600">
                  <LogOut className="w-4 h-4" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16 z-10">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-4">
            <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
              Không gian làm việc <span className="ft-gradient-text">FT Workspace</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {apps.map(app => {
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
        {loginModal}
      </div>
    );
  }

  if (viewMode === 'account-management') {
    if (userRole !== 'ADMIN') { setViewMode('workspace'); return null; }
    return (
      <>
        <div className="min-h-screen bg-slate-50 font-sans">
          <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8"><button onClick={() => setViewMode('workspace')} className="ft-btn ft-btn-secondary">Quay lại Workspace</button><span className="text-sm font-bold text-slate-700">Quản trị Workspace</span></div></header>
          <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><Suspense fallback={<div className="py-16 text-center text-sm text-slate-500">Đang tải quản lý tài khoản...</div>}><AccountManagement idToken={idToken || ''} userRole={userRole} /></Suspense></main>
        </div>
        {loginModal}
      </>
    );
  }

  if (viewMode === 'email-builder') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Trình tạo Email...</div>}>
          <EmailTemplateBuilder
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={isGuest ? () => { setAuthError(''); setShowLoginModal(true); } : handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
          />
        </Suspense>
        {loginModal}
      </>
    );
  }

  if (viewMode === 'digital-training') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Đào tạo số...</div>}>
          <DigitalTraining
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={isGuest ? () => { setAuthError(''); setShowLoginModal(true); } : handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
          />
        </Suspense>
        {loginModal}
      </>
    );
  }

  if (viewMode === 'examination') {
    return (
      <>
        <ExaminationErrorBoundary>
          <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Khảo thí...</div>}>
            <ExaminationModule
              onBackToWorkspace={() => setViewMode('workspace')}
              userName={user.displayName}
              userEmail={user.email}
              idToken={idToken}
              googleAccessToken={googleAccessToken}
              userRole={userRole}
              isGuest={isGuest}
              onAccountClick={isGuest ? () => { setAuthError(''); setShowLoginModal(true); } : handleLogout}
            />
          </Suspense>
        </ExaminationErrorBoundary>
        {loginModal}
      </>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        userRole={userRole}
        idToken={idToken || ''}
        onLogout={handleLogout}
        onLogin={() => { setAuthError(''); setShowLoginModal(true); }}
        onBackToWorkspace={() => setViewMode('workspace')}
      />
      <main className="flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-7">
        {loading ? (
          <div className="grid h-full place-items-center text-sm font-semibold text-slate-500">Đang tải dữ liệu...</div>
        ) : (
          <div className="max-w-[1600px] mx-auto">
            <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-slate-500">Đang tải mô-đun...</div>}>
              {activeTab === 'dashboard' && (
                <Dashboard idToken={idToken || ''} googleAccessToken={googleAccessToken} channels={channels} />
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
      </main>
      {loginModal}
    </div>
  );
}
