'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface HistoryItem {
  url: string;
  title: string;
  bookTitle: string;
  timestamp: number;
}

interface User {
  id: number;
  email: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Authentication form states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const router = useRouter();

  // Validate session on mount
  useEffect(() => {
    checkAuthSession();
  }, []);

  const checkAuthSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
          fetchDatabaseHistory();
          setCheckingAuth(false);
          return;
        }
      }
    } catch (e) {
      console.error('Session verification failed', e);
    }
    setUser(null);
    loadLocalStorageHistory();
    setCheckingAuth(false);
  };

  const loadLocalStorageHistory = () => {
    const stored = localStorage.getItem('novel_reader_history');
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  };

  const fetchDatabaseHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        if (data.history) {
          setHistory(data.history);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to retrieve server history', e);
    }
    loadLocalStorageHistory();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    router.push(`/reader?url=${encodeURIComponent(url.trim())}`);
  };

  const loadDemo = () => {
    const demoUrl = 'https://m.ilwxs.com/shu/116202/164559017.html';
    router.push(`/reader?url=${encodeURIComponent(demoUrl)}`);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setAuthError('');
    setAuthLoading(true);

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (data.success && data.user) {
        setUser(data.user);
        setShowAuthModal(false);
        setEmail('');
        setPassword('');
        
        // Load combined database history
        fetchDatabaseHistory();
      }
    } catch (err: any) {
      setAuthError(err.message || 'An error occurred during authentication.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      loadLocalStorageHistory();
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  const clearHistory = () => {
    localStorage.removeItem('novel_reader_history');
    setHistory([]);
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Decorative Blur Elements */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '20%',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, rgba(255,255,255,0) 70%)',
        filter: 'blur(80px)',
        zIndex: -1,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '10%',
        right: '10%',
        width: '400px',
        height: '400px',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.1) 0%, rgba(255,255,255,0) 70%)',
        filter: 'blur(80px)',
        zIndex: -1,
        pointerEvents: 'none'
      }} />

      {/* Main Navigation Header */}
      <header className="glass" style={{
        margin: '1rem',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.25rem' }}>📖</span>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>Novel Translator</span>
        </div>

        <div>
          {checkingAuth ? (
            <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>Validating session...</span>
          ) : user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.8 }}>
                👤 {user.email}
              </span>
              <button onClick={handleLogout} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}>
                Logout
              </button>
            </div>
          ) : (
            <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px' }}>
              Sign In
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem' }}>
        <div className="glass animate-fade-in" style={{
          width: '100%',
          maxWidth: '680px',
          padding: '3rem 2.5rem',
          textAlign: 'center',
          border: '1px solid var(--border-color)',
        }}>
          {/* Logo / Header */}
          <div style={{ marginBottom: '2.5rem' }}>
            <span style={{
              background: 'linear-gradient(135deg, var(--accent-color), var(--accent-hover))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: '0.85rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              display: 'block',
              marginBottom: '0.5rem'
            }}>
              Premium
            </span>
            <h1 style={{
              fontSize: '2.75rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--text-color)',
              marginBottom: '1rem',
              lineHeight: 1.15
            }}>
              Novel Translator
            </h1>
            <p style={{
              color: 'var(--text-color)',
              opacity: 0.7,
              fontSize: '1.05rem',
              lineHeight: 1.6,
              maxWidth: '480px',
              margin: '0 auto'
            }}>
              Immersive, ad-free book reader. Translate and clean Chinese web novels on the fly with custom reading themes.
            </p>
          </div>

          {/* Search Loader Form */}
          <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="url"
                required
                className="input-field"
                placeholder="Paste Chinese novel chapter URL (e.g. m.ilwxs.com)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{
                  paddingRight: '50px',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)',
                  fontFamily: 'inherit'
                }}
              />
              {url && (
                <button
                  type="button"
                  onClick={() => setUrl('')}
                  style={{
                    position: 'absolute',
                    right: '15px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-color)',
                    opacity: 0.5,
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    padding: '4px'
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Start Reading
              </button>
              <button type="button" onClick={loadDemo} className="btn-secondary">
                ⚡ Try Demo Chapter
              </button>
            </div>
          </form>

          {/* Demo Chapter Quick Access */}
          <div style={{
            fontSize: '0.85rem',
            opacity: 0.6,
            color: 'var(--text-color)',
            marginBottom: '2.5rem'
          }}>
            Example: <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={loadDemo}>通天仙录 Chapter 277 (m.ilwxs.com)</span>
          </div>

          {/* Sync Prompt Banner */}
          {!user && (
            <div className="glass" style={{
              padding: '1rem',
              marginBottom: '2rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px dashed var(--border-color)',
              background: 'rgba(211, 84, 0, 0.03)'
            }}>
              <span style={{ textAlign: 'left', opacity: 0.85 }}>
                💡 <strong>Save & Sync:</strong> Log in to sync your read novel chapters across all of your devices using our SQLite database storage.
              </span>
              <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-color)',
                fontWeight: 700,
                cursor: 'pointer',
                textDecoration: 'underline',
                whiteSpace: 'nowrap',
                marginLeft: '10px'
              }}>
                Sign In ➔
              </button>
            </div>
          )}

          {/* Library / History */}
          {history.length > 0 && (
            <div style={{ textAlign: 'left', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-color)' }}>
                  {user ? '☁️ Synchronized Library' : '📖 Recently Read'}
                </h3>
                {!user && (
                  <button
                    onClick={clearHistory}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-color)',
                      opacity: 0.5,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    Clear Library
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.slice(0, 5).map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => router.push(`/reader?url=${encodeURIComponent(item.url)}`)}
                    className="glass"
                    style={{
                      padding: '1rem 1.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s ease',
                      border: '1px solid var(--border-color)',
                      background: 'rgba(255, 255, 255, 0.02)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)';
                      e.currentTarget.style.borderColor = 'var(--accent-color)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '1rem' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-color)' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-color)', opacity: 0.6, marginTop: '0.2rem' }}>
                        {item.bookTitle || 'Loaded Novel'}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Resume ➔
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Glassmorphic Sliding Auth Modal */}
      {showAuthModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }} onClick={() => setShowAuthModal(false)}>
          <div className="glass animate-fade-in" style={{
            width: '100%',
            maxWidth: '420px',
            padding: '2.5rem',
            position: 'relative',
            border: '1px solid var(--border-color)',
            onClick: (e) => e.stopPropagation()
          }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowAuthModal(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                color: 'var(--text-color)',
                opacity: 0.6,
                cursor: 'pointer',
                fontSize: '1.25rem',
                padding: '4px'
              }}
            >
              ✕
            </button>

            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p style={{ fontSize: '0.9rem', opacity: 0.7, marginBottom: '2rem' }}>
              {authMode === 'login' ? 'Access your synchronized reading database' : 'Sync your reading list seamlessly'}
            </p>

            {authError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
                padding: '0.75rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '1.5rem',
                textAlign: 'left'
              }}>
                ⚠️ {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: '0.4rem' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  className="input-field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              <div style={{ textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: '0.4rem' }}>
                  Password
                </label>
                <input
                  type="password"
                  required
                  className="input-field"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" className="btn-primary" disabled={authLoading} style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
                {authLoading ? 'Verifying...' : authMode === 'login' ? 'Sign In' : 'Register Account'}
              </button>
            </form>

            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '2rem', paddingTop: '1.25rem', fontSize: '0.85rem' }}>
              {authMode === 'login' ? (
                <span>
                  New to Novel Translator?{' '}
                  <button onClick={() => setAuthMode('register')} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                    Register now
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{' '}
                  <button onClick={() => setAuthMode('login')} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                    Sign In
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '2rem 1.5rem',
        fontSize: '0.8rem',
        opacity: 0.5,
        color: 'var(--text-color)',
        borderTop: '1px solid var(--border-color)',
        marginTop: 'auto'
      }}>
        Novel Translator © 2026. Custom crafted premium aesthetics for book lovers.
      </footer>
    </main>
  );
}
