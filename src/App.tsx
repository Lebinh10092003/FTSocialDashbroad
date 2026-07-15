import React, { useState, useEffect } from 'react';
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

// Components
// Icons for login screen
import { ShieldAlert, AlertTriangle, Key, Layers, Lock, Mail, UserPlus, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Channels from './components/Channels';
import Posts from './components/Posts';
import Sync from './components/Sync';
import Reports from './components/Reports';
import Config from './components/Config';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('VIEWER');
  
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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
    // Ensure standard Workspace scopes are added
    googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
    googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');
    googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthChecking(true);
      if (currentUser) {
        setUser(currentUser);
        try {
          const token = await currentUser.getIdToken(true);
          setIdToken(token);
          
          // Fetch backend profile & role
          const profileRes = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            setUserRole(profile.role);
          }

          // Fetch systemConfig for the last Google Access Token to automatically restore Sheets connection!
          const configRes = await fetch('/api/admin/config', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (configRes.ok) {
            const configData = await configRes.json();
            if (configData.lastGoogleAccessToken) {
              setGoogleAccessToken(configData.lastGoogleAccessToken);
              console.log('Tự động khôi phục kết nối Google Sheets từ hệ thống:', configData.lastGoogleAccessToken.substring(0, 10) + '...');
            }
          }
        } catch (e) {
          console.error('Lỗi khi lấy ID token hoặc phân quyền:', e);
        }
      } else {
        setUser(null);
        setIdToken(null);
        setGoogleAccessToken(null);
        setUserRole('VIEWER');
      }
      setAuthChecking(false);
    });

    return () => unsubscribe();
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
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Đăng xuất thất bại:', err);
    }
    setUser(null);
    setIdToken(null);
    setGoogleAccessToken(null);
    setUserRole('VIEWER');
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
        handleRefreshChannels();
      }
    }
  }, [idToken, activeTab]);

  // Loading screen
  if (authChecking) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-slate-500">Đang khởi chạy FT Social Analytics...</p>
      </div>
    );
  }

  // Login view
  if (!user || !idToken) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200/80 rounded-3xl p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center font-bold text-white text-2xl shadow-md">
              FT
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">FT Social Analytics</h1>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">Hệ thống phân tích tương tác và đồng bộ báo cáo Facebook & Zalo OA chuyên nghiệp.</p>
          </div>

          <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-100 text-[11px] text-blue-800 leading-relaxed text-center">
            🔒 <strong>Hệ thống nội bộ bảo mật cao:</strong> Tài khoản phải do Quản trị viên (Admin) khởi tạo và cấp phát trực tiếp. Đăng ký tự do đã được tắt.
          </div>

          <form onSubmit={handleCredentialsAuth} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Tên đăng nhập hoặc Email
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-4 h-4 text-slate-400" />
                </span>
                <input
                  type="text"
                  required
                  placeholder="admin hoặc admin@ftsocial.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Mật khẩu
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-4 h-4 text-slate-400" />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Nhập mật khẩu của bạn"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 h-4" /> : <Eye className="h-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs p-3 rounded-xl flex flex-col gap-2 animate-shake">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
                {authError.includes('CHƯA BẬT ĐĂNG NHẬP EMAIL/PASSWORD') && (
                  <div className="mt-1 p-3 bg-white rounded-lg border border-rose-200 text-slate-700 space-y-2 text-[11px] leading-relaxed text-left">
                    <p className="font-bold text-rose-700">Hướng dẫn kích hoạt chi tiết:</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Bấm vào liên kết này để mở cấu hình: <a href="https://console.firebase.google.com/project/gen-lang-client-0289137855/authentication/providers" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-bold hover:text-blue-800">Cấu hình Firebase Auth</a>.</li>
                      <li>Chọn tab <strong>Sign-in method</strong> ở phía trên.</li>
                      <li>Chọn <strong>Add new provider</strong> (Thêm nhà cung cấp mới) và nhấp chọn <strong>Email/Password</strong>.</li>
                      <li>Gạt công tắc <strong>Enable</strong> (Bật) ở mục đầu tiên và bấm <strong>Save</strong> (Lưu).</li>
                    </ol>
                    <p className="text-emerald-700 font-medium">Sau khi bật xong, hãy tải lại trang này và đăng nhập lại bình thường!</p>
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 flex gap-2.5 text-[11px] leading-relaxed text-slate-600">
              <Key className="w-4.5 h-4.5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-800 font-bold block">Tài khoản admin mặc định:</strong>
                Tên đăng nhập <code className="bg-blue-100/60 px-1 py-0.5 rounded text-blue-700 font-bold font-mono">admin</code> và mật khẩu <code className="bg-blue-100/60 px-1 py-0.5 rounded text-blue-700 font-bold font-mono">Admin123</code>.
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-[0.99]"
            >
              {authLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Đăng nhập hệ thống</span>
                </>
              )}
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-slate-400">Hoặc sử dụng tài khoản Google</span>
              </div>
            </div>

            <button
              type="button"
              disabled={authLoading}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-[0.99]"
            >
              <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Đăng nhập bằng Google (Cấp quyền Sheets)</span>
            </button>
          </form>

          <p className="text-[10px] text-center text-slate-400">Copyright © 2026 FT Social. Powered by Cloud Run containers.</p>
        </div>
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
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-8 py-8 md:px-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-semibold text-slate-400">Đang đồng bộ danh mục kênh...</p>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && (
              <Dashboard 
                idToken={idToken} 
                googleAccessToken={googleAccessToken}
                channels={channels}
              />
            )}
            {activeTab === 'channels' && (
              <Channels 
                idToken={idToken}
                googleAccessToken={googleAccessToken}
                channels={channels}
                userRole={userRole}
                onRefreshChannels={handleRefreshChannels}
              />
            )}
            {activeTab === 'posts' && (
              <Posts 
                idToken={idToken}
                channels={channels}
              />
            )}
            {activeTab === 'sync' && (
              <Sync 
                idToken={idToken}
                googleAccessToken={googleAccessToken}
                channels={channels}
                userRole={userRole}
                onRefreshChannels={handleRefreshChannels}
                onConnectGoogle={handleConnectGoogle}
              />
            )}
            {activeTab === 'reports' && (
              <Reports 
                idToken={idToken}
                channels={channels}
              />
            )}
            {activeTab === 'config' && (
              <Config 
                idToken={idToken}
                googleAccessToken={googleAccessToken}
                userRole={userRole}
                onConnectGoogle={handleConnectGoogle}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
