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
import Sidebar from './components/Sidebar';

const Dashboard = lazy(() => import('./components/Dashboard'));
const MediaSummary = lazy(() => import('./components/MediaSummary'));
const Posts = lazy(() => import('./components/Posts'));
const Sync = lazy(() => import('./components/Sync'));
const Config = lazy(() => import('./components/Config'));
const AccountManagement = lazy(() => import('./components/AccountManagement'));
const EmailTemplateBuilder = lazy(() => import('./components/email-builder/EmailTemplateBuilder'));
const ExaminationModule = lazy(() => import('./components/ExaminationModule'));

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('EMPLOYEE');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const isGuest = user?.email === 'guest@ftsocial.com';
  const [viewMode, setViewModeState] = useState<'workspace' | 'social-dashboard' | 'email-builder' | 'examination'>('workspace');
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      if (path.startsWith('/social-dashboard')) {
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

  const setViewMode = (mode: 'workspace' | 'social-dashboard' | 'email-builder' | 'examination') => {
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
      
      setUser(adminUser);
      setIdToken('mock-dev-token-admin@ftsocial.com');
      setGoogleAccessToken('mock-google-access-token');
      setUserRole('ADMIN');
      setAuthLoading(false);
      setShowLoginModal(false);
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
          // Send a fast request to save the Google access token in Firestore systemConfig
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
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-slate-500">Đang khởi chạy FT Social Analytics...</p>
      </div>
    );
  }

  // Render Workspace Portal
  if (viewMode === 'workspace') {
    return (
      <div className="min-h-screen liquid-bg flex flex-col justify-between text-slate-700 font-sans relative">
        <div className="glow-sphere-1"></div>
        <div className="glow-sphere-2"></div>
        
        {/* Header */}
        <header className="w-full max-w-6xl mx-auto px-6 py-6 flex justify-between items-center z-10">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="FermatTech Logo" className="h-9 object-contain" />
            <div className="border-l border-slate-200 pl-4">
              <h1 className="font-extrabold text-slate-950 text-base leading-none tracking-tight">Fermat Workspace Dashboard</h1>
              <p className="text-[9px] uppercase font-bold text-amber-600 tracking-wider mt-1">Workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 bg-white/80 backdrop-blur-md px-4 py-2 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[11px] font-bold text-slate-600">
                {user?.email === 'guest@ftsocial.com' ? 'Chế độ xem' : 'Quản trị viên'}
              </span>
            </div>
            {user?.email === 'guest@ftsocial.com' ? (
              <button 
                onClick={() => setShowLoginModal(true)} 
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-650 text-white font-bold text-xs px-4 py-2 rounded-2xl shadow-md cursor-pointer hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                Đăng nhập
              </button>
            ) : (
              <button 
                onClick={handleLogout} 
                className="flex items-center gap-2 bg-slate-100 hover:bg-rose-50 text-slate-650 hover:text-rose-600 font-bold text-xs px-4 py-2 rounded-2xl border border-slate-200/60 hover:border-rose-100 cursor-pointer active:scale-[0.98] transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                Đăng xuất
              </button>
            )}
      </div>
    </header>

        {/* Main Portal View */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-10 flex flex-col justify-center z-10">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-none">
              Không gian làm việc <span className="text-gold-gradient">FT Workspace</span>
            </h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Cổng quản trị hợp nhất các công cụ đồng bộ dữ liệu, phân tích mạng xã hội và tự động hóa quy trình chăm sóc khách hàng.
            </p>
          </div>

          {/* Apps Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full">
            {/* Card 1: Active Social Analytics app */}
            <div 
              onClick={() => {
                setViewMode('social-dashboard');
                setActiveTab('dashboard');
              }}
              className="glass-card p-6.5 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[220px]"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-650 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Social Analytics Dashboard
                    <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-200 uppercase tracking-wide">Đang chạy</span>
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Hệ thống tích hợp dữ liệu, theo dõi tương tác thời gian thực từ Facebook Page, Zalo OA và đồng bộ tự động báo cáo Google Sheets.
                  </p>
                </div>
              </div>
              <div className="pt-4 flex items-center text-xs font-bold text-amber-600 group-hover:translate-x-1 transition-transform">
                Truy cập ứng dụng &rarr;
              </div>
            </div>

            {/* Card 2: Active Email Builder app */}
            <div 
              onClick={() => {
                setViewMode('email-builder');
              }}
              className="glass-card p-6.5 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[220px]"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-blue-600 to-indigo-650 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                  <Mail className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Trình tạo Email
                    <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-200 uppercase tracking-wide">Đang hoạt động</span>
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Thiết kế email có hình ảnh, nội dung cá nhân hóa và copy trực tiếp vào Gmail.
                  </p>
                </div>
              </div>
              <div className="pt-4 flex items-center text-xs font-bold text-amber-600 group-hover:translate-x-1 transition-transform">
                Truy cập ứng dụng &rarr;
              </div>
            </div>



            {/* Card 5: Examination */}
            <div
              onClick={() => setViewMode('examination')}
              className="glass-card p-6.5 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[220px]"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/10 group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">Khảo thí <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-200 uppercase tracking-wide">Đang chạy</span></h3>
                  <p className="text-xs text-slate-500 leading-relaxed">Quản lý cuộc thi, kỳ tổ chức, thí sinh và quy trình nhập dữ liệu tại FermatTech.</p>
                </div>
              </div>
              <div className="pt-4 flex items-center text-xs font-bold text-amber-600 group-hover:translate-x-1 transition-transform">Truy cập ứng dụng →</div>
            </div>
            {/* Card 6: Digital Training (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-cyan-500/10">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v11.494m-9-5.747h18M4.5 8.5h15M4.5 15.5h15M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">Đào tạo số <span className="text-[9px] bg-slate-100 text-slate-500 font-extrabold px-1.5 py-0.5 rounded-full border border-slate-200 uppercase tracking-wide">Sắp ra mắt</span></h3>
                  <p className="text-xs text-slate-500 leading-relaxed">Công tác đào tạo Chuyển đổi số, Đào tạo Ứng dụng AI trong công việc.</p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-slate-400">Đang phát triển</div>
            </div>          </div>
        </main>

        {/* Footer */}
        <footer className="w-full text-center py-6 text-[10px] text-slate-400 z-10 border-t border-slate-200">
          Copyright &copy; 2026 FermatTech Workspace. Powered by Cloud Run containers & VPS PM2 engines.
        </footer>
      </div>
    );
  }

  if (viewMode === 'email-builder') {
    return (
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold text-slate-500">Đang nạp Trình tạo Email...</p>
        </div>
      }>
        <EmailTemplateBuilder onBackToWorkspace={() => setViewMode('workspace')} />
      </Suspense>
    );
  }

  if (viewMode === 'examination') {
    return (
      <ExaminationErrorBoundary>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-500">Đang nạp mô-đun Khảo thí...</div>}>
          <ExaminationModule
            onBackToWorkspace={() => setViewMode('workspace')}
            userName={user?.displayName}
            userEmail={user?.email}
            userRole={userRole}
            isGuest={isGuest}
            onAccountClick={() => isGuest ? setShowLoginModal(true) : handleLogout()}
          />
        </Suspense>
      </ExaminationErrorBoundary>
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
          <div className="flex flex-col items-center justify-center h-full space-y-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-semibold text-slate-400">Đang đồng bộ danh mục kênh...</p>
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
              {activeTab === 'media' && <MediaSummary idToken={idToken || ''} />}
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

      {/* Popup Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-6">
          <div className="relative w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-9 md:p-10 space-y-5 animate-fade-in">
            {/* Nút đóng */}
            <button 
              onClick={() => setShowLoginModal(false)} 
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all cursor-pointer"
              aria-label="Đóng cửa sổ"
            >
              ✕
            </button>
            
            <form onSubmit={handleCredentialsAuth} className="space-y-5">
              <div className="text-center mb-4 flex flex-col items-center">
                <img src="/logo.png" alt="FermatTech Logo" className="h-10 object-contain mb-3" />
                <h1 className="text-xl font-extrabold text-slate-900 leading-tight">FermatTech Workspace</h1>
              </div>
              
              <div className="space-y-3">
                <input 
                  value={loginEmail} 
                  onChange={e => setLoginEmail(e.target.value)} 
                  placeholder="Email"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" 
                  autoComplete="username" 
                />
                <input 
                  value={loginPassword} 
                  onChange={e => setLoginPassword(e.target.value)} 
                  type="password" 
                  placeholder="Mật khẩu" 
                  className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" 
                  autoComplete="current-password" 
                />
              </div>
              
              {authError && <p className="text-xs text-rose-600 font-semibold">{authError}</p>}
              
              <button 
                disabled={authLoading} 
                className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-all cursor-pointer"
              >
                {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
              <button 
                type="button" 
                onClick={handleGoogleSignIn} 
                disabled={authLoading} 
                className="w-full rounded-xl border border-slate-200 py-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-all cursor-pointer"
              >
                Đăng nhập bằng Google
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
