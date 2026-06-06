'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Reader() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUrl = searchParams.get('url');

  const [loading, setLoading] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  
  // Content states
  const [title, setTitle] = useState('');
  const [translatedTitle, setTranslatedTitle] = useState('');
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [translatedParagraphs, setTranslatedParagraphs] = useState<string[]>([]);
  const [prevUrl, setPrevUrl] = useState('');
  const [nextUrl, setNextUrl] = useState('');
  const [indexUrl, setIndexUrl] = useState('');

  // Reader Settings
  const [theme, setTheme] = useState<'sepia' | 'dark' | 'light' | 'mint'>('sepia');
  const [fontSize, setFontSize] = useState<number>(20);
  const [layoutMode, setLayoutMode] = useState<'single' | 'dual'>('single');
  const [translationMode, setTranslationMode] = useState<'zh' | 'en' | 'bilingual'>('zh');
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<number>(0); // 0 = stopped, 1-5 speed levels
  const [showSettings, setShowSettings] = useState(false);

  // Text to speech states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(-1);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch the novel chapter data
  const fetchChapter = async (url: string) => {
    setLoading(true);
    setError('');
    setTranslatedParagraphs([]);
    setTranslatedTitle('');
    if (translationMode !== 'zh') {
      setTranslationMode('zh');
    }

    try {
      const res = await fetch(`/api/fetch-novel?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        throw new Error('Failed to retrieve content from the novel website.');
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setTitle(data.title || 'Untitled Chapter');
      setParagraphs(data.paragraphs || []);
      setPrevUrl(data.prevUrl || '');
      setNextUrl(data.nextUrl || '');
      setIndexUrl(data.indexUrl || '');

      // Save to local storage reading history
      saveToHistory(url, data.title || 'Untitled Chapter');

    } catch (e: any) {
      console.error(e);
      setError(e.message || 'An unexpected error occurred while parsing the novel page.');
    } finally {
      setLoading(false);
    }
  };

  // Helper to save current chapter to LocalStorage history and SQLite database
  const saveToHistory = async (url: string, chapterTitle: string) => {
    try {
      // 1. LocalStorage Fallback/Primary
      const stored = localStorage.getItem('novel_reader_history');
      let list = [];
      if (stored) {
        list = JSON.parse(stored);
      }
      list = list.filter((item: any) => item.url !== url);
      list.unshift({
        url,
        title: chapterTitle,
        bookTitle: '通天仙录',
        timestamp: Date.now()
      });
      localStorage.setItem('novel_reader_history', JSON.stringify(list.slice(0, 20)));

      // 2. Synchronize to SQLite in the background
      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: chapterTitle, bookTitle: '通天仙录' })
      });
    } catch (e) {
      console.error('Failed to update reading history', e);
    }
  };

  // Translate all paragraphs via server API
  const translateContent = async () => {
    if (translatedParagraphs.length > 0) {
      setTranslationMode('en');
      return;
    }

    setTranslating(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paragraphs, title }),
      });

      if (!res.ok) throw new Error('Translation failed');
      const data = await res.json();
      
      setTranslatedParagraphs(data.translatedParagraphs || []);
      setTranslatedTitle(data.translatedTitle || '');
      setTranslationMode('en');
    } catch (e) {
      console.error(e);
      alert('Failed to translate content. Please try again.');
    } finally {
      setTranslating(false);
    }
  };

  // Auto scroll effect
  useEffect(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
    }

    if (autoScrollSpeed > 0) {
      const intervalMs = 120 - autoScrollSpeed * 20; // faster scroll = lower delay
      scrollIntervalRef.current = setInterval(() => {
        window.scrollBy({ top: 1, behavior: 'auto' });
      }, intervalMs);
    }

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, [autoScrollSpeed]);

  // Keybindings for page flipping navigation (Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && nextUrl) {
        navigateToUrl(nextUrl);
      } else if (e.key === 'ArrowLeft' && prevUrl) {
        navigateToUrl(prevUrl);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevUrl, nextUrl]);

  // Navigate function
  const navigateToUrl = (url: string) => {
    stopSpeaking();
    router.push(`/reader?url=${encodeURIComponent(url)}`);
  };

  // Theme application
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load device voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const allVoices = window.speechSynthesis.getVoices();
        setVoices(allVoices);
        // Find a default English voice, or fallback to first available
        const defaultVoice = allVoices.find(v => v.lang.startsWith('en')) || allVoices[0];
        if (defaultVoice) {
          setSelectedVoice(defaultVoice.name);
        }
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Stop TTS if user activates Auto-scroll to prevent conflict
  useEffect(() => {
    if (autoScrollSpeed > 0 && (isSpeaking || currentParagraphIndex >= 0)) {
      stopSpeaking();
    }
  }, [autoScrollSpeed]);

  // Cleanup active speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakParagraph = (index: number) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    // Turn off Auto Scroll if we speak
    setAutoScrollSpeed(0);

    const paragraphsToRead = translationMode === 'zh' ? paragraphs : (translatedParagraphs.length > 0 ? translatedParagraphs : paragraphs);
    if (index < 0 || index >= paragraphsToRead.length) {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentParagraphIndex(-1);
      return;
    }

    setCurrentParagraphIndex(index);
    setIsSpeaking(true);
    setIsPaused(false);

    // Scroll active paragraph to center smoothly
    const el = document.getElementById(`para-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const utterance = new SpeechSynthesisUtterance(paragraphsToRead[index]);
    utterance.rate = speechRate;
    
    if (selectedVoice) {
      const voice = voices.find(v => v.name === selectedVoice);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => {
      speakParagraph(index + 1);
    };

    utterance.onerror = (e) => {
      console.error('Speech error:', e);
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const pauseSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const resumeSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentParagraphIndex(-1);
    }
  };

  // Initial load
  useEffect(() => {
    if (targetUrl) {
      fetchChapter(targetUrl);
    }
  }, [targetUrl]);

  if (!targetUrl) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <h2 className="text-xl font-bold mb-4">No chapter URL was provided.</h2>
        <Link href="/" className="btn-primary">Return to Library</Link>
      </div>
    );
  }

  const currentDisplayTitle = translationMode === 'en' && translatedTitle
    ? translatedTitle
    : title;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontSize: `${fontSize}px`
    }}>
      {/* HUD Bar (Upper panel) */}
      <header className="glass" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        padding: '0.75rem 1.5rem',
        margin: 0,
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.9rem',
      }}>
        {/* Navigation / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link href="/" style={{
            textDecoration: 'none',
            color: 'var(--text-color)',
            fontWeight: 700,
            opacity: 0.8,
            fontSize: '0.85rem'
          }}>
            ◀ Library
          </Link>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span className="header-title" style={{
            fontWeight: 600,
            color: 'var(--text-color)',
            opacity: 0.6,
            maxWidth: '180px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }} title={currentDisplayTitle}>
            {currentDisplayTitle}
          </span>
          {nextUrl && (
            <>
              <span style={{ color: 'var(--border-color)' }}>|</span>
              <button
                onClick={() => navigateToUrl(nextUrl)}
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  transition: 'opacity 0.2s',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                Next ▶
              </button>
            </>
          )}
        </div>

        {/* Configurations Dashboard - Desktop */}
        <div className="desktop-settings" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Themes Panel */}
          <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(0,0,0,0.05)', padding: '4px', borderRadius: '8px' }}>
            {(['sepia', 'dark', 'light', 'mint'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{
                  border: 'none',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  backgroundColor: t === 'sepia' ? '#f7f1e3' : t === 'dark' ? '#0f172a' : t === 'light' ? '#f8f9fa' : '#edf5f1',
                  border: theme === t ? '2px solid var(--accent-color)' : '1px solid rgba(0,0,0,0.1)',
                  boxShadow: theme === t ? '0 0 8px var(--accent-color)' : 'none'
                }}
                title={`Switch to ${t} theme`}
              />
            ))}
          </div>

          {/* Text Size controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setFontSize(Math.max(14, fontSize - 2))}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                width: '30px',
                height: '30px',
                cursor: 'pointer',
                color: 'var(--text-color)',
                fontSize: '0.85rem'
              }}
            >
              A-
            </button>
            <button
              onClick={() => setFontSize(Math.min(36, fontSize + 2))}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                width: '30px',
                height: '30px',
                cursor: 'pointer',
                color: 'var(--text-color)',
                fontSize: '1rem'
              }}
            >
              A+
            </button>
          </div>

          {/* Translation controls */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {translationMode === 'zh' ? (
              <button
                onClick={translateContent}
                className="btn-primary"
                disabled={translating}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {translating ? 'Translating...' : 'Translate ➔'}
              </button>
            ) : (
              <div className="glass" style={{ display: 'flex', padding: '2px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                {(['zh', 'en', 'bilingual'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTranslationMode(mode)}
                    style={{
                      background: translationMode === mode ? 'var(--accent-color)' : 'none',
                      color: translationMode === mode ? '#fff' : 'var(--text-color)',
                      border: 'none',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600
                    }}
                  >
                    {mode === 'zh' ? '中文' : mode === 'en' ? 'EN' : 'Bilingual'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Auto-scroll HUD or Text-to-Speech Controls */}
          {currentParagraphIndex >= 0 || isSpeaking ? (
            /* Speech Control Panel */
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? '▶' : '⏸'}
              </button>
              <button
                onClick={stopSpeaking}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Stop"
              >
                ⏹
              </button>
              {voices.length > 0 && (
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  style={{
                    background: 'var(--panel-bg)',
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '4px',
                    fontSize: '0.75rem',
                    maxWidth: '120px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name.slice(0, 15)}...
                    </option>
                  ))}
                </select>
              )}
              <select
                value={speechRate}
                onChange={(e) => {
                  const newRate = Number(e.target.value);
                  setSpeechRate(newRate);
                  if (isSpeaking && currentParagraphIndex >= 0) {
                    speakParagraph(currentParagraphIndex);
                  }
                }}
                style={{
                  background: 'var(--panel-bg)',
                  color: 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '4px',
                  fontSize: '0.75rem',
                  outline: 'none',
                  cursor: 'pointer'
                }}
                title="Speech Speed"
              >
                <option value={0.5}>0.5x</option>
                <option value={0.75}>0.75x</option>
                <option value={1.0}>1.0x (Normal)</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={1.75}>1.75x</option>
                <option value={2.0}>2.0x</option>
              </select>
            </div>
          ) : (
            /* Standard Auto-scroll dropdown, plus a Read Aloud button if translated */
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(translationMode === 'en' || translationMode === 'bilingual') && (
                <button
                  onClick={() => speakParagraph(0)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: 'var(--text-color)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  🔊 Read
                </button>
              )}
              <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Scroll:</span>
              <select
                value={autoScrollSpeed}
                onChange={(e) => setAutoScrollSpeed(Number(e.target.value))}
                style={{
                  background: 'var(--panel-bg)',
                  color: 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '4px',
                  fontSize: '0.8rem',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value={0}>Off</option>
                <option value={1}>Speed 1</option>
                <option value={2}>Speed 2</option>
                <option value={3}>Speed 3</option>
                <option value={4}>Speed 4</option>
                <option value={5}>Speed 5</option>
              </select>
            </div>
          )}

          {/* Dual vs Single Layout */}
          <button
            onClick={() => setLayoutMode(layoutMode === 'single' ? 'dual' : 'single')}
            style={{
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer',
              color: 'var(--text-color)',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'none', // hide on mobile, display in media query
            }}
            className="layout-toggle-btn"
          >
            {layoutMode === 'single' ? '📖 Book Mode' : '📄 Scroll Mode'}
          </button>
        </div>

        {/* Configurations Dashboard - Mobile Toggle */}
        <button
          className="mobile-settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: 'none',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: 'pointer',
            color: 'var(--text-color)',
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'none',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          {showSettings ? '✕ Close' : '⚙️ Options'}
        </button>
      </header>

      {/* Mobile Configurations Panel */}
      {showSettings && (
        <div className="glass mobile-settings-panel" style={{
          position: 'fixed',
          top: '50px',
          right: '10px',
          left: '10px',
          zIndex: 99,
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          fontSize: '0.85rem',
          boxShadow: 'var(--card-shadow)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Theme:</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {(['sepia', 'dark', 'light', 'mint'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  style={{
                    border: 'none',
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    backgroundColor: t === 'sepia' ? '#f7f1e3' : t === 'dark' ? '#0f172a' : t === 'light' ? '#f8f9fa' : '#edf5f1',
                    border: theme === t ? '2px solid var(--accent-color)' : '1px solid rgba(0,0,0,0.1)',
                    boxShadow: theme === t ? '0 0 8px var(--accent-color)' : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Font Size:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => setFontSize(Math.max(14, fontSize - 2))}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.8rem'
                }}
              >
                A-
              </button>
              <span style={{ fontWeight: 600 }}>{fontSize}px</span>
              <button
                onClick={() => setFontSize(Math.min(36, fontSize + 2))}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.9rem'
                }}
              >
                A+
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Translation:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {translationMode === 'zh' ? (
                <button
                  onClick={() => {
                    translateContent();
                    setShowSettings(false);
                  }}
                  className="btn-primary"
                  disabled={translating}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    borderRadius: '8px',
                  }}
                >
                  {translating ? 'Translating...' : 'Translate ➔'}
                </button>
              ) : (
                <div className="glass" style={{ display: 'flex', padding: '2px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  {(['zh', 'en', 'bilingual'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTranslationMode(mode)}
                      style={{
                        background: translationMode === mode ? 'var(--accent-color)' : 'none',
                        color: translationMode === mode ? '#fff' : 'var(--text-color)',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}
                    >
                      {mode === 'zh' ? '中文' : mode === 'en' ? 'EN' : 'Bilingual'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {currentParagraphIndex >= 0 || isSpeaking ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Speech Controls:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                    style={{
                      background: 'var(--accent-color)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      width: '32px',
                      height: '32px',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    {isPaused ? '▶' : '⏸'}
                  </button>
                  <button
                    onClick={stopSpeaking}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      width: '32px',
                      height: '32px',
                      cursor: 'pointer',
                      color: 'var(--text-color)',
                      fontSize: '0.85rem'
                    }}
                  >
                    ⏹
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Speech Settings:</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {voices.length > 0 && (
                    <select
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      style={{
                        background: 'var(--panel-bg)',
                        color: 'var(--text-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '6px',
                        fontSize: '0.8rem',
                        maxWidth: '120px',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      {voices.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name.slice(0, 12)}...
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={speechRate}
                    onChange={(e) => {
                      const newRate = Number(e.target.value);
                      setSpeechRate(newRate);
                      if (isSpeaking && currentParagraphIndex >= 0) {
                        speakParagraph(currentParagraphIndex);
                      }
                    }}
                    style={{
                      background: 'var(--panel-bg)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '6px',
                      fontSize: '0.8rem',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={0.75}>0.75x</option>
                    <option value={1.0}>1.0x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={1.75}>1.75x</option>
                    <option value={2.0}>2.0x</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Auto Scroll:</span>
                <select
                  value={autoScrollSpeed}
                  onChange={(e) => setAutoScrollSpeed(Number(e.target.value))}
                  style={{
                    background: 'var(--panel-bg)',
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '6px',
                    fontSize: '0.8rem',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '120px'
                  }}
                >
                  <option value={0}>Off</option>
                  <option value={1}>Speed 1</option>
                  <option value={2}>Speed 2</option>
                  <option value={3}>Speed 3</option>
                  <option value={4}>Speed 4</option>
                  <option value={5}>Speed 5</option>
                </select>
              </div>

              {(translationMode === 'en' || translationMode === 'bilingual') && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Read Aloud:</span>
                  <button
                    onClick={() => {
                      speakParagraph(0);
                      setShowSettings(false);
                    }}
                    className="btn-primary"
                    style={{
                      padding: '6px 16px',
                      fontSize: '0.8rem',
                      borderRadius: '8px',
                    }}
                  >
                    🔊 Read novel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Styled css injection */}
      <style jsx global>{`
        @media (min-width: 1200px) {
          .layout-toggle-btn {
            display: inline-block !important;
          }
        }
        @media (max-width: 900px) {
          .desktop-settings {
            display: none !important;
          }
          .mobile-settings-toggle {
            display: flex !important;
          }
          .header-title {
            max-width: 100px !important;
          }
        }
        @media (max-width: 768px) {
          .reader-content-card {
            padding: 1.25rem 1rem !important;
          }
          .reader-grid {
            padding: 1rem 0.5rem 6rem !important;
            gap: 1rem !important;
          }
          .novel-paragraph {
            text-indent: 1.5em !important;
            margin-bottom: 1.2em !important;
          }
        }
      `}</style>

      {/* Main Viewport Content */}
      <div style={{ flex: 1 }}>
        {loading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            gap: '1rem'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid var(--border-color)',
              borderTopColor: 'var(--accent-color)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <p style={{ opacity: 0.7, fontSize: '1rem' }}>Extracting & cleansing novel text...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div className="glass" style={{
            maxWidth: '500px',
            margin: '4rem auto',
            padding: '2.5rem',
            textAlign: 'center',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            background: 'rgba(239, 68, 68, 0.05)'
          }}>
            <h3 style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '1.25rem' }}>⚠️ Parsing Failed</h3>
            <p style={{ opacity: 0.8, fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>{error}</p>
            <button onClick={() => fetchChapter(targetUrl)} className="btn-primary" style={{ marginRight: '1rem' }}>
              🔄 Retry
            </button>
            <Link href="/" className="btn-secondary">Back to Library</Link>
          </div>
        ) : (
          <article className="animate-fade-in" style={{ padding: '1rem 0' }}>
            {/* Title HUD */}
            <div style={{ textAlign: 'center', maxWidth: '800px', margin: '2rem auto 3rem', padding: '0 1.5rem' }}>
              <h1 style={{
                fontSize: '2.25rem',
                fontWeight: 800,
                color: 'var(--text-color)',
                marginBottom: '1rem',
                lineHeight: 1.2,
                fontFamily: 'var(--font-title)'
              }}>
                {translationMode === 'en' && translatedTitle
                  ? translatedTitle
                  : translationMode === 'bilingual' && translatedTitle
                  ? `${title} / ${translatedTitle}`
                  : title}
              </h1>
              <p style={{ fontSize: '0.85rem', opacity: 0.5 }}>
                Origin: <a href={targetUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-color)', textDecoration: 'underline' }}>View Original Webpage</a>
              </p>
            </div>

            {/* Reading Grid */}
            <div className={`reader-grid ${layoutMode === 'dual' ? 'two-columns' : ''}`}>
              {/* Dual Layout: Left Column = Chinese, Right Column = English */}
              {layoutMode === 'dual' ? (
                <>
                  <div className="novel-content-cn glass reader-content-card" style={{ border: '1px solid var(--border-color)' }}>
                    <h3 style={{ marginBottom: '2rem', fontSize: '1.4rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>中文原文</h3>
                    {paragraphs.map((p, idx) => (
                      <p
                        key={idx}
                        id={`para-${idx}`}
                        className="novel-paragraph"
                        style={{
                          backgroundColor: currentParagraphIndex === idx && translationMode === 'zh' ? 'rgba(211, 84, 0, 0.12)' : 'transparent',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          margin: '0 -8px 1.2em',
                          transition: 'background-color 0.3s ease'
                        }}
                      >
                        {p}
                      </p>
                    ))}
                  </div>
                  <div className="novel-content-en glass reader-content-card" style={{ border: '1px solid var(--border-color)' }}>
                    <h3 style={{ marginBottom: '2rem', fontSize: '1.4rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>English Translation</h3>
                    {translatedParagraphs.length > 0 ? (
                      translatedParagraphs.map((p, idx) => (
                        <p
                          key={idx}
                          id={`para-${idx}`}
                          className="novel-paragraph"
                          style={{
                            backgroundColor: currentParagraphIndex === idx && (translationMode === 'en' || translationMode === 'bilingual') ? 'rgba(211, 84, 0, 0.12)' : 'transparent',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            margin: '0 -8px 1.2em',
                            transition: 'background-color 0.3s ease'
                          }}
                        >
                          {p}
                        </p>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', padding: '4rem 1rem', opacity: 0.6 }}>
                        <p style={{ marginBottom: '1.5rem' }}>No English translation active.</p>
                        <button onClick={translateContent} className="btn-primary">
                          Translate to English
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* Single Column Scroll Mode */
                <div className="glass reader-content-card" style={{ maxWidth: '800px', margin: '0 auto', width: '100%', border: '1px solid var(--border-color)' }}>
                  {/* Chinese only */}
                  {translationMode === 'zh' && (
                    <div className="novel-content-cn">
                      {paragraphs.map((p, idx) => (
                        <p
                          key={idx}
                          id={`para-${idx}`}
                          className="novel-paragraph"
                          style={{
                            backgroundColor: currentParagraphIndex === idx && translationMode === 'zh' ? 'rgba(211, 84, 0, 0.12)' : 'transparent',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            margin: '0 -8px 1.2em',
                            transition: 'background-color 0.3s ease'
                          }}
                        >
                          {p}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* English only */}
                  {translationMode === 'en' && (
                    <div className="novel-content-en">
                      {translatedParagraphs.length > 0 ? (
                        translatedParagraphs.map((p, idx) => (
                          <p
                            key={idx}
                            id={`para-${idx}`}
                            className="novel-paragraph"
                            style={{
                              backgroundColor: currentParagraphIndex === idx && (translationMode === 'en' || translationMode === 'bilingual') ? 'rgba(211, 84, 0, 0.12)' : 'transparent',
                              borderRadius: '6px',
                              padding: '4px 8px',
                              margin: '0 -8px 1.2em',
                              transition: 'background-color 0.3s ease'
                            }}
                          >
                            {p}
                          </p>
                        ))
                      ) : (
                        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                          <p style={{ marginBottom: '1rem' }}>Preparing English Translation...</p>
                          <button onClick={translateContent} className="btn-primary" disabled={translating}>
                            {translating ? 'Translating content...' : 'Load translation'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bilingual View */}
                  {translationMode === 'bilingual' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                      {paragraphs.map((p, idx) => (
                        <div
                          key={idx}
                          id={`para-${idx}`}
                          style={{
                            borderLeft: `3px solid ${currentParagraphIndex === idx ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            paddingLeft: '1rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            backgroundColor: currentParagraphIndex === idx ? 'rgba(211, 84, 0, 0.08)' : 'transparent',
                            borderRadius: '0 6px 6px 0',
                            paddingTop: '6px',
                            paddingBottom: '6px',
                            transition: 'all 0.3s ease'
                          }}
                        >
                          <p className="novel-content-cn" style={{ textIndent: 0, opacity: 0.6, fontSize: '0.9em' }}>{p}</p>
                          <p className="novel-content-en" style={{ textIndent: 0, fontWeight: 500 }}>
                            {translatedParagraphs[idx] || '...'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Immersive Book Navigation Buttons */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '1.5rem',
              margin: '3rem auto 5rem',
              maxWidth: '600px',
              padding: '0 1.5rem'
            }}>
              <button
                onClick={() => prevUrl && navigateToUrl(prevUrl)}
                disabled={!prevUrl}
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center', opacity: prevUrl ? 1 : 0.4, cursor: prevUrl ? 'pointer' : 'not-allowed' }}
              >
                ◀ Previous Chapter
              </button>
              
              {indexUrl && (
                <button
                  onClick={() => navigateToUrl(indexUrl)}
                  className="btn-secondary"
                  style={{ flex: 0.5, justifyContent: 'center' }}
                >
                  📖 Index
                </button>
              )}

              <button
                onClick={() => nextUrl && navigateToUrl(nextUrl)}
                disabled={!nextUrl}
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', opacity: nextUrl ? 1 : 0.4, cursor: nextUrl ? 'pointer' : 'not-allowed' }}
              >
                Next Chapter ▶
              </button>
            </div>
          </article>
        )}
      </div>

      {/* Persistent Floating Controls (Keyboard hint) */}
      <div className="glass" style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '8px 14px',
        fontSize: '0.75rem',
        opacity: 0.5,
        pointerEvents: 'none',
        display: 'flex',
        gap: '10px',
        border: '1px solid var(--border-color)',
        zIndex: 999
      }}>
        <span>⌨ Use Left / Right arrows to flip chapters</span>
      </div>
    </div>
  );
}
