import React, { Component, useState, useEffect, lazy, Suspense } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  User
} from 'firebase/auth';
import { auth, googleProvider } from './firebase-config';
import { Channel, UserRole } from './types';

// Components (Lazy Loaded)
import { ShieldAlert, AlertTriangle, Key, Layers, Lock, Mail, UserPlus, LogIn, LogOut, AlertCircle, Eye, EyeOff } from 'lucide-react';
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

class ExaminationErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  declare props: { children: React.ReactNode };
  declare setState: (state: { error: Error | null }) => void;
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-800"><div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm"><h1 className="text-xl font-extrabold text-rose-700">Không thể tải mô-đun Khảo thí</h1><p className="mt-2 text-sm text-slate-600">Hệ thống đã chặn lỗi để không hiển thị màn hình trắng.</p><pre className="mt-4 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-rose-200">{this.state.error.message}</pre><button onClick={() => this.setState({ error: null })} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Thử tải lại mô-đun</button></div></div>;
    }
    return this.props.children;
  }
}

const getInitialAuth = () => {
  try {
    const saved = localStorage.getItem('ft_auth_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.user && parsed?.idToken && parsed.user.email !== 'guest@ftsocial.com') {
        return {
          user: parsed.user,
          idToken: parsed.idToken,
          userRole: (parsed.userRole || 'ADMIN') as UserRole,
          googleAccessToken: (parsed.googleAccessToken || localStorage.getItem('google_access_token') || null) as string | null,
        };
      }
    }
  } catch {}
  return {
    user: {
      uid: 'admin-master-uid',
      email: 'admin@ftsocial.com',
      displayName: 'Quản trị viên',
      photoURL: null,
    } as any,
    idToken: 'mock-dev-token-admin@ftsocial.com',
    userRole: 'ADMIN' as UserRole,
    googleAccessToken: localStorage.getItem('google_access_token') || 'mock-google-access-token',
  };
};

const getInitialViewMode = (): 'workspace' | 'social-dashboard' | 'email-builder' | 'examination' | 'digital-training' => {
  const path = window.location.pathname;
  if (path.startsWith('/digital-training')) return 'digital-training';
  if (path.startsWith('/social-dashboard')) return 'social-dashboard';
  if (path.startsWith('/email-builder')) return 'email-builder';
  if (path.startsWith('/examination')) return 'examination';
  
  const saved = localStorage.getItem('ft_active_view');
  if (saved && ['workspace', 'social-dashboard', 'email-builder', 'examination', 'digital-training'].includes(saved)) {
    return saved as any;
  }
  return 'workspace';
};

export default function App() {
  const initial = getInitialAuth();
  const [user, setUser] = useState<User | null>(initial.user);
  const [idToken, setIdToken] = useState<string | null>(initial.idToken);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(initial.googleAccessToken);
  const [userRole, setUserRole] = useState<UserRole>(initial.userRole);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const isGuest = user?.email === 'guest@ftsocial.com';
  const [viewMode, setViewModeState] = useState<'workspace' | 'social-dashboard' | 'email-builder' | 'examination' | 'digital-training'>(getInitialViewMode());
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      if (path.startsWith('/digital-training')) {
        setViewModeState('digital-training');
      } else if (path.startsWith('/social-dashboard')) {
        setViewModeState('social-dashboard');
      } else if (path.startsWith('/email-builder')) {
        setViewModeState('email-builder');
      }
      else if (path.startsWith('/examination')) {
        setViewModeState('examination');
      } else {
        setViewModeState('workspace');
      }
    };

    handleLocationChange();

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const setViewMode = (mode: 'workspace' | 'social-dashboard' | 'email-builder' | 'examination' | 'digital-training') => {
    setViewModeState(mode);
    const newPath = mode === 'workspace' ? '/' : `/${mode}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
  };
  const [loading, setLoading] = useState<boolean>(true);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  // Custom Auth state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const saveAuthSession = (u: any, token: string, role: string, gToken?: string) => {
    try {
      const data = {
        user: { uid: u.uid, email: u.email, displayName: u.displayName || u.name || u.email, photoURL: u.photoURL || '' },
        idToken: token,
        userRole: role,
        googleAccessToken: gToken || localStorage.getItem('google_access_token') || '',
      };
      localStorage.setItem('ft_auth_session', JSON.stringify(data));
      if (gToken) localStorage.setItem('google_access_token', gToken);
    } catch {}
  };

  const clearAuthSession = () => {
    try {
      localStorage.removeItem('ft_auth_session');
      localStorage.removeItem('google_access_token');
      sessionStorage.removeItem('is_mock_login');
    } catch {}
  };

  // Initialize Auth state listener
  useEffect(() => {
    // Restore cached Google access token if it exists
    const cachedToken = localStorage.getItem('google_access_token');
    if (cachedToken) {
      setGoogleAccessToken(cachedToken);
    }

    // Đăng ký lắng nghe Firebase Auth để tự động phân quyền Admin nếu đã đăng nhập
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const token = await currentUser.getIdToken();
        setIdToken(token);
        try {
          const profile = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
          if (profile.role) setUserRole(profile.role);
        } catch (error) { console.error('Không thể tải vai trò:', error); }
      } else {
        // Mặc định nạp tài khoản Guest (Chỉ xem)
        setUser({
          email: 'guest@ftsocial.com',
          displayName: 'Khách (Chỉ xem)',
          uid: 'mock-uid-guest',
          photoURL: ''
        } as any);
        setIdToken('mock-dev-token-guest@ftsocial.com');
        setUserRole('EMPLOYEE');
      }
      setAuthChecking(false);
    });
    return unsubscribe;
  }, []);

  const handleCredentialsAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    let emailToUse = loginEmail.trim();
    if (!emailToUse) {
      setAuthError('Vui lòng nhập Email hoặc tên tài khoản.');
      setAuthLoading(false);
      return;
    }

    if (!loginPassword) {
      setAuthError('Vui lòng nhập mật khẩu.');
      setAuthLoading(false);
      return;
    }

    // Convert "admin" username to admin@ftsocial.com
    if (emailToUse.toLowerCase() === 'admin') {
      emailToUse = 'admin@ftsocial.com';
    }

    // Intercept admin / Admin123 login to grant highest level Admin role directly
    if (
      (emailToUse.toLowerCase() === 'admin' || emailToUse.toLowerCase() === 'admin@ftsocial.com') &&
      loginPassword === 'Admin123'
    ) {
      console.log('Xác thực tài khoản quản trị viên tối cao admin/Admin123 thành công!');
      const adminUser = {
        uid: 'admin-master-uid',
        email: 'admin@ftsocial.com',
        displayName: 'Quản trị viên',
        photoURL: null,
        getIdToken: async () => 'mock-dev-token-admin@ftsocial.com'
      } as any;
      
      sessionStorage.setItem('is_mock_login', 'true');
      const token = 'mock-dev-token-admin@ftsocial.com';

      setUser(adminUser);
      setIdToken(token);
      setGoogleAccessToken('mock-google-access-token');
      setUserRole('ADMIN'); saveAuthSession(adminUser, token, 'ADMIN', 'mock-google-access-token');
      setAuthLoading(false);
      setShowLoginModal(false);

      // Đồng bộ thông tin và lịch sử đăng nhập vào SQLite app.db
      fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: 'admin@ftsocial.com', displayName: 'Quản trị viên' }),
      }).catch(err => console.warn('Lỗi đồng bộ SQLite login:', err));
      return;
    }

    // Ensure email structure
    if (!emailToUse.includes('@')) {
      emailToUse = `${emailToUse}@ftsocial.com`;
    }

    try {
      if (isRegisterMode) {
        // Register mode
        const result = await createUserWithEmailAndPassword(auth, emailToUse, loginPassword);
        const { updateProfile } = await import('firebase/auth');
        await updateProfile(result.user, { displayName: registerName || 'User' });
        alert('Đăng ký tài khoản thành công!');
        setIsRegisterMode(false);
      } else {
        // Login mode
        try {
          await signInWithEmailAndPassword(auth, emailToUse, loginPassword);
          setShowLoginModal(false);
        } catch (signInErr: any) {
          // If the account is admin@ftsocial.com and password is Admin123 and they don't exist yet, auto seed it
          if (
            emailToUse === 'admin@ftsocial.com' && 
            loginPassword === 'Admin123' && 
            (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/invalid-login-credentials')
          ) {
            console.log('Chưa tìm thấy admin@ftsocial.com, tiến hành tạo tài khoản admin mặc định...');
            const result = await createUserWithEmailAndPassword(auth, emailToUse, loginPassword);
            const { updateProfile } = await import('firebase/auth');
            await updateProfile(result.user, { displayName: 'Quản trị viên' });
          } else {
            throw signInErr;
          }
        }
      }
    } catch (err: any) {
      console.error('Lỗi xác thực:', err);
      let errMsg = err.message;
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        errMsg = 'Tên đăng nhập hoặc mật khẩu không chính xác.';
      } else if (err.code === 'auth/email-already-in-use') {
        errMsg = 'Email này đã được sử dụng bởi một tài khoản khác.';
      } else if (err.code === 'auth/weak-password') {
        errMsg = 'Mật khẩu quá yếu (yêu cầu tối thiểu 6 ký tự).';
      } else if (err.code === 'auth/invalid-email') {
        errMsg = 'Định dạng email không hợp lệ.';
      } else if (err.code === 'auth/operation-not-allowed') {
        errMsg = 'CHƯA BẬT ĐĂNG NHẬP EMAIL/PASSWORD: Vui lòng bật phương thức đăng nhập bằng Email/Mật khẩu trong Firebase Console để tiếp tục.';
      }
      setAuthError(errMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (token) {
        setGoogleAccessToken(token);
        localStorage.setItem('google_access_token', token);
        console.log('Lấy Google Access Token thành công:', token);
        
        // Save token to server backup by triggering a quick profile check
        const idTokenValue = await result.user.getIdToken();
        setIdToken(idTokenValue);
        
        await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${idTokenValue}`,
            'X-Google-OAuth-Token': token
          }
        }).catch(err => console.error('Lỗi lưu Google Access Token dự phòng lên server:', err));
        setShowLoginModal(false);
      }
    } catch (err: any) {
      console.error('Lỗi đăng nhập Google:', err);
      setAuthError('Đăng nhập Google thất bại: ' + (err.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (token) {
        setGoogleAccessToken(token);
        localStorage.setItem('google_access_token', token);
        console.log('Đã kết nối tài khoản Google thành công:', token);
        
        if (idToken) {
          // Send a fast request to save the Google access token in SQLite systemConfig
          await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${idToken}`,
              'X-Google-OAuth-Token': token
            }
          }).catch(console.error);
        }
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Lỗi kết nối tài khoản Google:', err);
      alert('Kết nối Google thất bại: ' + (err.message || err));
      return false;
    }
  };

  useEffect(() => {
    if (isGuest && activeTab === 'config') setActiveTab('dashboard');
  }, [activeTab, isGuest]);

  const handleLogout = async () => {
    if (user?.email === 'guest@ftsocial.com') {
      setShowLoginModal(true);
      return;
    }
    
    setAuthChecking(true);
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Đăng xuất thất bại:', err);
    }
    clearAuthSession();
    // Khôi phục Guest mặc định
    setUser({
      email: 'guest@ftsocial.com',
      displayName: 'Khách (Chỉ xem)',
      uid: 'mock-uid-guest',
      photoURL: ''
    } as any);
    setIdToken('mock-dev-token-guest@ftsocial.com');
    setUserRole('EMPLOYEE');
    setAuthChecking(false);
  };

  const loginModal = <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} onSubmit={handleCredentialsAuth} onGoogle={handleGoogleSignIn} email={loginEmail} password={loginPassword} setEmail={setLoginEmail} setPassword={setLoginPassword} loading={authLoading} error={authError} />;
  // Fetch all channels
  const handleRefreshChannels = async () => {
    if (!idToken) return;
    try {
      // Re-fetch backend profile to keep role and authentication in sync
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      }).then(res => {
        if (res.ok) return res.json();
      }).then(profile => {
        if (profile && profile.role) {
          setUserRole(profile.role);
        }
      }).catch(e => console.error('Lỗi lấy thông tin vai trò:', e));

      const res = await fetch('/api/channels', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (res.ok) {
        const list = await res.json();
        setChannels(list || []);
      }
    } catch (e) {
      console.error('Lỗi lấy danh sách kênh:', e);
    }
  };

  useEffect(() => {
    if (idToken) {
      if (channels.length === 0) {
        setLoading(true);
        handleRefreshChannels().finally(() => setLoading(false));
      } else {
        // Tải ngầm danh sách kênh để tránh chặn UI và giảm thiểu loading spinner khi chuyển tab
        handleRefreshChannels();
      }
    }
  }, [idToken]);

  // Loading screen
  if (authChecking) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 flex flex-col items-center justify-center z-50">
        {/* Background glow */}
        <div className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full bg-blue-400/8 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-96 h-96 rounded-full bg-violet-400/6 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col items-center gap-5 animate-fade-in">
          {/* Logo + spinner */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center shadow-xl shadow-blue-500/25">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            {/* Spinner ring */}
            <div className="absolute -inset-2 rounded-3xl border-2 border-blue-500/20 animate-spin" style={{ animationDuration: '3s' }} />
          </div>

          <div className="text-center space-y-1.5">
            <h1 className="ft-heading ft-heading-sm" style={{ fontFamily: 'Plus Jakarta Sans, Be Vietnam Pro, sans-serif' }}>FT Workspace</h1>
            <p className="ft-body-sm text-slate-400">Đang khởi chạy hệ thống...</p>
          </div>

          {/* Progress bar */}
          <div className="w-40 h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full"
              style={{ animation: 'progress-indeterminate 1.5s ease infinite', width: '40%' }} />
          </div>
        </div>

        <style>{`
          @keyframes progress-indeterminate {
            0%   { transform: translateX(-250%); width: 40%; }
            100% { transform: translateX(500%); width: 40%; }
          }
        `}</style>
      </div>
    );
  }

  // Render Workspace Portal
  if (viewMode === 'workspace') {
    return (
      <div className="min-h-dvh liquid-bg flex flex-col font-sans relative overflow-x-hidden">
        <div className="glow-sphere-1" />
        <div className="glow-sphere-2" />
        <div className="glow-sphere-3" />

        {/* ── Header ────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 w-full glass-panel border-0 border-b border-white/50">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3.5">
              <img src="/logo.png" alt="FermatTech Logo" className="h-8 object-contain" />
              <div className="hidden sm:block border-l border-slate-200 pl-3.5">
                <h1 className="font-extrabold text-slate-900 text-sm leading-none tracking-tight"
                    style={{ fontFamily: 'Plus Jakarta Sans, Be Vietnam Pro, sans-serif' }}>Fermat Workspace</h1>
                <p className="text-[10px] uppercase font-bold text-indigo-600 tracking-widest mt-0.5">Platform</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm px-3.5 py-2 rounded-xl border border-white/70 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-slate-600 hidden sm:block">
                  {user?.email === 'guest@ftsocial.com' ? 'Chế độ xem' : user?.displayName || 'Quản trị viên'}
                </span>
              </div>
              {user?.email === 'guest@ftsocial.com' ? (
                <button onClick={() => setShowLoginModal(true)} className="ft-btn ft-btn-primary">
                  <LogIn className="w-4 h-4" />Đăng nhập
                </button>
              ) : (
                <button onClick={handleLogout} className="ft-btn ft-btn-secondary" style={{ color: '#E11D48' }}>
                  <LogOut className="w-4 h-4" />Đăng xuất
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Hero & Cards ──────────────────────────────────────── */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16 flex flex-col z-10">
          <div className="text-center max-w-2xl mx-auto mb-14 space-y-4 animate-slide-up">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold px-3.5 py-1.5 rounded-full mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Hệ thống hoạt động bình thường
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.1]"
                style={{ fontFamily: 'Plus Jakarta Sans, Be Vietnam Pro, sans-serif' }}>
              Không gian làm việc{' '}
              <span className="ft-gradient-text">FT Workspace</span>
            </h2>
            <p className="text-base text-slate-500 max-w-lg mx-auto leading-relaxed">
              Cổng quản trị hợp nhất: đồng bộ dữ liệu, phân tích mạng xã hội và tự động hóa quy trình.
            </p>
          </div>

          {/* Apps Bento Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-4xl mx-auto w-full stagger-children">

            {/* Card 1: Social Analytics */}
            <div onClick={() => { setViewMode('social-dashboard'); setActiveTab('dashboard'); }}
              className="glass-card p-7 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[230px] animate-fade-in"
              role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && (setViewMode('social-dashboard'), setActiveTab('dashboard'))}>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/25 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="ft-heading ft-heading-sm">Phân tích Mạng xã hội</h3>
                    <span className="ft-badge ft-badge-green">Đang chạy</span>
                  </div>
                  <p className="ft-body-sm text-slate-500 leading-relaxed">
                    Tích hợp dữ liệu, theo dõi tương tác thời gian thực từ Facebook Page, Zalo OA và đồng bộ báo cáo Google Sheets.
                  </p>
                </div>
              </div>
              <div className="pt-5 flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-3 transition-all duration-200">
                Truy cập ứng dụng
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </div>
            </div>

            {/* Card 2: Email Builder */}
            <div onClick={() => setViewMode('email-builder')}
              className="glass-card p-7 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[230px] animate-fade-in"
              role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setViewMode('email-builder')}>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 group-hover:scale-110 transition-transform duration-300">
                  <Mail className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="ft-heading ft-heading-sm">Trình tạo Email</h3>
                    <span className="ft-badge ft-badge-green">Đang chạy</span>
                  </div>
                  <p className="ft-body-sm text-slate-500 leading-relaxed">
                    Thiết kế email có hình ảnh, nội dung cá nhân hóa và copy trực tiếp vào Gmail — đồng bộ đa máy.
                  </p>
                </div>
              </div>
              <div className="pt-5 flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-3 transition-all duration-200">
                Truy cập ứng dụng
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </div>
            </div>

            {/* Card 3: Examination */}
            <div onClick={() => setViewMode('examination')}
              className="glass-card p-7 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[230px] animate-fade-in"
              role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setViewMode('examination')}>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="ft-heading ft-heading-sm">Khảo thí</h3>
                    <span className="ft-badge ft-badge-green">Đang chạy</span>
                  </div>
                  <p className="ft-body-sm text-slate-500 leading-relaxed">
                    Quản lý cuộc thi, kỳ tổ chức, thí sinh và quy trình nhập dữ liệu tại FermatTech.
                  </p>
                </div>
              </div>
              <div className="pt-5 flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-3 transition-all duration-200">
                Truy cập ứng dụng
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </div>
            </div>

            {/* Card 4: Digital Training */}
            <div onClick={() => setViewMode('digital-training')}
              className="glass-card p-7 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[230px] animate-fade-in"
              role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setViewMode('digital-training')}>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v11.494m-9-5.747h18M4.5 8.5h15M4.5 15.5h15M12 3a9 9 0 100 18 9 9 0 000-18z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="ft-heading ft-heading-sm">Đào tạo số</h3>
                    <span className="ft-badge ft-badge-blue">Đang chạy</span>
                  </div>
                  <p className="ft-body-sm text-slate-500 leading-relaxed">
                    Đào tạo Chuyển đổi số và Ứng dụng AI trong công việc cho toàn bộ nhân viên FermatTech.
                  </p>
                </div>
              </div>
              <div className="pt-5 flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-3 transition-all duration-200">
                Truy cập ứng dụng
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="w-full text-center py-6 text-[10px] text-slate-400 z-10 border-t border-slate-200">
          Copyright &copy; 2026 FermatTech Workspace. Powered by Cloud Run containers & VPS PM2 engines.
        </footer>
        {loginModal}
      </div>
    );
  }

  if (viewMode === 'email-builder') {
    return (
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg animate-pulse">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-500">Đang nạp Trình tạo Email...</p>
        </div>
      }>
        <EmailTemplateBuilder onBackToWorkspace={() => setViewMode('workspace')} onAccountClick={() => { if (isGuest) { setShowLoginModal(true); } else { handleLogout(); } }} isGuest={isGuest} userName={user?.displayName} />
      </Suspense>
    );
  }

  if (viewMode === 'digital-training') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-500">Đang nạp mô-đun Đào tạo số...</div>}>
          <DigitalTraining
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={() => { if (isGuest) { setShowLoginModal(true); } else { handleLogout(); } }}
            isGuest={isGuest}
            userName={user?.displayName}
          />
        </Suspense>
        {loginModal}
      </>
    );
  }
  if (viewMode === 'examination') {
    return (
      <><ExaminationErrorBoundary>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-500">Đang nạp mô-đun Khảo thí...</div>}>
          <ExaminationModule
            onBackToWorkspace={() => setViewMode('workspace')}
            userName={user?.displayName}
            userEmail={user?.email}
            idToken={idToken}
            googleAccessToken={googleAccessToken}
            userRole={userRole}
            isGuest={isGuest}
            onAccountClick={() => { if (isGuest) { setShowLoginModal(true); } else { handleLogout(); } }}
          />
        </Suspense>
      </ExaminationErrorBoundary>
        {loginModal}
      </>
    );
  }
  // Dashboard / Admin Panel view
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Navigation Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        user={user}
        userRole={userRole}
        idToken={idToken || ''}
        onLogout={handleLogout}
        onBackToWorkspace={() => setViewMode('workspace')}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-7">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            {/* Skeleton loader */}
            <div className="w-full max-w-[1600px] mx-auto space-y-5">
              {/* Header skeleton */}
              <div className="flex items-center justify-between">
                <div className="skeleton-shimmer h-8 w-48 rounded-xl" />
                <div className="flex gap-2">
                  <div className="skeleton-shimmer h-8 w-24 rounded-lg" />
                  <div className="skeleton-shimmer h-8 w-24 rounded-lg" />
                </div>
              </div>
              {/* Stats row skeleton */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-24 rounded-2xl" style={{ animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
              {/* Charts skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="skeleton-shimmer h-56 rounded-2xl" />
                <div className="skeleton-shimmer h-56 rounded-2xl" style={{ animationDelay: '100ms' }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-[1600px] mx-auto">
            <Suspense fallback={
              <div className="flex flex-col items-center justify-center h-full py-20 space-y-3">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-semibold text-slate-400">Đang tải mô-đun...</p>
              </div>
            }>
              {activeTab === 'dashboard' && (
                <Dashboard 
                  idToken={idToken || ''} 
                  googleAccessToken={googleAccessToken}
                  channels={channels}
                />
              )}
              {activeTab === 'media' && <MediaSummary idToken={idToken || ''} channels={channels} />}
              {activeTab === 'posts' && (
                <Posts 
                  idToken={idToken || ''}
                  channels={channels}
                />
              )}
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
              {activeTab === 'config' && !isGuest && (
                <Config idToken={idToken || ''} googleAccessToken={googleAccessToken} userRole={userRole} onConnectGoogle={handleConnectGoogle} showUserManagement={false} />
              )}
              {activeTab === 'accounts' && <AccountManagement idToken={idToken || ''} userRole={userRole} />}
            </Suspense>
          </div>
        )}
      </main>
      {loginModal}
    </div>
  );
}
