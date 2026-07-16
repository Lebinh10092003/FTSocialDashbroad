import React, { useState, useEffect, lazy, Suspense } from 'react';
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
import { ShieldAlert, AlertTriangle, Key, Layers, Lock, Mail, UserPlus, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import Sidebar from './components/Sidebar';

const Dashboard = lazy(() => import('./components/Dashboard'));
const MediaSummary = lazy(() => import('./components/MediaSummary'));
const Posts = lazy(() => import('./components/Posts'));
const Sync = lazy(() => import('./components/Sync'));
const Config = lazy(() => import('./components/Config'));
const AccountManagement = lazy(() => import('./components/AccountManagement'));

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('EMPLOYEE');  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [viewMode, setViewMode] = useState<'workspace' | 'app'>('workspace');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

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

    // Ensure standard Workspace scopes are added
    googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
    googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');
    googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');
    googleProvider.setCustomParameters({
      prompt: 'consent',
      access_type: 'offline'
    });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) { setUser(null); setIdToken(null); setUserRole('EMPLOYEE'); setAuthChecking(false); return; }
      setUser(currentUser);
      const token = await currentUser.getIdToken();
      setIdToken(token);
      try {
        const profile = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
        if (profile.role) setUserRole(profile.role);
      } catch (error) { console.error('Không thể tải vai trò:', error); }
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

  const handleLogout = async () => {
    sessionStorage.removeItem('is_mock_login');
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Đăng xuất thất bại:', err);
    }
    setUser(null);
    setIdToken(null);
    setGoogleAccessToken(null);
    setUserRole('EMPLOYEE');
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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <form onSubmit={handleCredentialsAuth} className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-lg shadow-slate-200/60 p-9 md:p-10 space-y-5">
          <div className="text-center mb-2">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-lg shadow-md shadow-blue-200">FT</div>
            <h1 className="mt-4 text-2xl font-extrabold text-slate-900">FermatTech Workspace</h1>
          </div>
          <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="username" />
          <input value={loginPassword} onChange={e => setLoginPassword(e.target.value)} type="password" placeholder="Mật khẩu" className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="current-password" />
          {authError && <p className="text-xs text-rose-600">{authError}</p>}
          <button disabled={authLoading} className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{authLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
          <button type="button" onClick={handleGoogleSignIn} disabled={authLoading} className="w-full rounded-xl border border-slate-200 py-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Đăng nhập bằng Google</button>
        </form>
      </div>
    );
  }
  // Render Workspace Portal
  if (viewMode === 'workspace') {
    return (
      <div className="min-h-screen liquid-bg flex flex-col justify-between text-stone-200 font-sans relative">
        <div className="glow-sphere-1"></div>
        <div className="glow-sphere-2"></div>
        
        {/* Header */}
        <header className="w-full max-w-6xl mx-auto px-6 py-6 flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-600 flex items-center justify-center font-bold text-white text-xl shadow-lg shadow-amber-950/40">
              FT
            </div>
            <div>
              <h1 className="font-extrabold text-white text-base leading-tight tracking-tight">FT Workspace</h1>
              <p className="text-[9px] uppercase font-bold text-amber-500 tracking-wider">Workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-stone-900/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[11px] font-bold text-stone-300">Hệ thống đang hoạt động</span>
          </div>
        </header>

        {/* Main Portal View */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-10 flex flex-col justify-center z-10">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
            <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-none">
              Không gian làm việc <span className="text-gold-gradient">FT Workspace</span>
            </h2>
            <p className="text-xs text-stone-400 max-w-md mx-auto">
              Cổng quản trị hợp nhất các công cụ đồng bộ dữ liệu, phân tích mạng xã hội và tự động hóa quy trình chăm sóc khách hàng.
            </p>
          </div>

          {/* Apps Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full">
            {/* Card 1: Active Social Analytics app */}
            <div 
              onClick={() => {
                setViewMode('app');
                setActiveTab('dashboard');
              }}
              className="glass-card p-6.5 rounded-3xl cursor-pointer group flex flex-col justify-between min-h-[220px]"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-650 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-900/30 group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    Social Analytics Dashboard
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wide">Đang chạy</span>
                  </h3>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Hệ thống tích hợp dữ liệu, theo dõi tương tác thời gian thực từ Facebook Page, Zalo OA và đồng bộ tự động báo cáo Google Sheets.
                  </p>
                </div>
              </div>
              <div className="pt-4 flex items-center text-xs font-bold text-amber-500 group-hover:translate-x-1 transition-transform">
                Truy cập ứng dụng &rarr;
              </div>
            </div>

            {/* Card 2: Zalo Broadcast (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-sky-400 to-blue-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-sky-950/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    Zalo Broadcast Hub
                    <span className="text-[9px] bg-stone-700/30 text-stone-400 font-extrabold px-1.5 py-0.5 rounded-full border border-stone-600/30 uppercase tracking-wide">Sắp ra mắt</span>
                  </h3>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Module gửi tin nhắn chăm sóc khách hàng hàng loạt, tối ưu hóa tiếp thị và hỗ trợ quản trị hội thoại tự động đa kênh.
                  </p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-stone-500">
                Đang phát triển
              </div>
            </div>

            {/* Card 3: AI Chatbot (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-purple-500 to-pink-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-purple-950/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    AI Auto-Responder Bot
                    <span className="text-[9px] bg-stone-700/30 text-stone-400 font-extrabold px-1.5 py-0.5 rounded-full border border-stone-600/30 uppercase tracking-wide">Sắp ra mắt</span>
                  </h3>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Tự động phản hồi bình luận, tin nhắn của khách hàng trên Facebook Page bằng công nghệ xử lý ngôn ngữ tự nhiên Google Gemini AI.
                  </p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-stone-500">
                Đang phát triển
              </div>
            </div>

            {/* Card 4: System Administration (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-amber-950/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    System Administration
                    <span className="text-[9px] bg-stone-700/30 text-stone-400 font-extrabold px-1.5 py-0.5 rounded-full border border-stone-600/30 uppercase tracking-wide">Sắp ra mắt</span>
                  </h3>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Cổng giám sát cấu hình phần cứng VPS, sao lưu cơ sở dữ liệu Firebase/JSON DB và quản lý phân quyền thành viên chi tiết.
                  </p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-stone-500">
                Đang phát triển
              </div>
            </div>

            {/* Card 5: Assessment (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-950/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">Khảo thí <span className="text-[9px] bg-stone-700/30 text-stone-400 font-extrabold px-1.5 py-0.5 rounded-full border border-stone-600/30 uppercase tracking-wide">Sắp ra mắt</span></h3>
                  <p className="text-xs text-stone-400 leading-relaxed">Quản lý các cuộc thi tại FermatTech.</p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-stone-500">Đang phát triển</div>
            </div>

            {/* Card 6: Digital Training (Coming Soon) */}
            <div className="glass-card p-6.5 rounded-3xl opacity-80 relative group flex flex-col justify-between min-h-[220px]">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-cyan-950/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v11.494m-9-5.747h18M4.5 8.5h15M4.5 15.5h15M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">Đào tạo số <span className="text-[9px] bg-stone-700/30 text-stone-400 font-extrabold px-1.5 py-0.5 rounded-full border border-stone-600/30 uppercase tracking-wide">Sắp ra mắt</span></h3>
                  <p className="text-xs text-stone-400 leading-relaxed">Công tác đào tạo Chuyển đổi số, Đào tạo Ứng dụng AI trong công việc.</p>
                </div>
              </div>
              <div className="pt-4 text-xs font-bold text-stone-500">Đang phát triển</div>
            </div>          </div>
        </main>

        {/* Footer */}
        <footer className="w-full text-center py-6 text-[10px] text-stone-500 z-10 border-t border-white/5">
          Copyright &copy; 2026 FermatTech Workspace. Powered by Cloud Run containers & VPS PM2 engines.
        </footer>
      </div>
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
              {activeTab === 'config' && (
                <Config idToken={idToken || ''} googleAccessToken={googleAccessToken} userRole={userRole} onConnectGoogle={handleConnectGoogle} showUserManagement={false} />
              )}
              {activeTab === 'accounts' && <AccountManagement idToken={idToken || ''} userRole={userRole} />}
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}
