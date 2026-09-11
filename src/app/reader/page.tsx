'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface ChapterItem {
  id: string;
  url: string;
  title: string;
  bookTitle?: string;
  translatedTitle?: string;
  paragraphs: string[];
  translatedParagraphs: string[];
  prevUrl: string;
  nextUrl: string;
  indexUrl: string;
  isTranslating?: boolean;
}

export default function Reader() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUrl = searchParams.get('url');

  // Chapters list for infinite scroll / continuous reading
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingNext, setLoadingNext] = useState(false);
  const [error, setError] = useState('');

  // Reader Preferences
  const [theme, setTheme] = useState<'sepia' | 'dark' | 'light' | 'mint'>('sepia');
  const [fontSize, setFontSize] = useState<number>(20);
  const [layoutMode, setLayoutMode] = useState<'single' | 'dual'>('single');
  const [translationMode, setTranslationMode] = useState<'zh' | 'en' | 'bilingual'>('zh');
  const [autoContinue, setAutoContinue] = useState<boolean>(true); // Infinite scroll toggle
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<number>(0); // 0 = off, 1-5 speed levels
  const [showSettings, setShowSettings] = useState(false);

  // Voice / TTS states
  const [ttsEngine, setTtsEngine] = useState<'device' | 'cloud'>('device');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [speechPitch, setSpeechPitch] = useState<number>(1.0);
  const [activeSpeechLoc, setActiveSpeechLoc] = useState<{ chapterIdx: number; paraIdx: number } | null>(null);

  // Active chapter in viewport (for HUD and URL sync)
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);

  // References
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const chaptersRef = useRef<ChapterItem[]>([]);
  chaptersRef.current = chapters;

  const translationModeRef = useRef(translationMode);
  translationModeRef.current = translationMode;

  const activeLocRef = useRef(activeSpeechLoc);
  activeLocRef.current = activeSpeechLoc;

  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  // Theme application
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load device synthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const allVoices = window.speechSynthesis.getVoices();
        setVoices(allVoices);
        if (!selectedVoice && allVoices.length > 0) {
          const defaultVoice = allVoices.find(v => v.lang.startsWith('en')) || allVoices[0];
          if (defaultVoice) setSelectedVoice(defaultVoice.name);
        }
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoice]);

  // Helper to save reading history
  const saveToHistory = async (url: string, chapterTitle: string, bookTitle: string = 'Novel') => {
    try {
      const stored = localStorage.getItem('novel_reader_history');
      let list = stored ? JSON.parse(stored) : [];
      list = list.filter((item: any) => item.url !== url);
      list.unshift({
        url,
        title: chapterTitle,
        bookTitle: bookTitle || 'Novel',
        timestamp: Date.now()
      });
      localStorage.setItem('novel_reader_history', JSON.stringify(list.slice(0, 25)));

      // Sync to backend SQLite
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: chapterTitle, bookTitle })
      }).catch(() => {});
    } catch (e) {
      console.error('Failed to update history', e);
    }
  };

  // Translate a specific chapter by index
  const translateChapter = async (chapterIdx: number) => {
    const chap = chaptersRef.current[chapterIdx];
    if (!chap || chap.translatedParagraphs.length > 0 || chap.isTranslating) return;

    // Mark as translating
    setChapters(prev => prev.map((c, i) => i === chapterIdx ? { ...c, isTranslating: true } : c));

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paragraphs: chap.paragraphs, title: chap.title }),
      });

      if (!res.ok) throw new Error('Translation failed');
      const data = await res.json();

      setChapters(prev => prev.map((c, i) => {
        if (i === chapterIdx) {
          return {
            ...c,
            translatedParagraphs: data.translatedParagraphs || [],
            translatedTitle: data.translatedTitle || '',
            isTranslating: false,
          };
        }
        return c;
      }));
    } catch (err) {
      console.error('Failed to translate chapter', err);
      setChapters(prev => prev.map((c, i) => i === chapterIdx ? { ...c, isTranslating: false } : c));
    }
  };

  // Translate all loaded chapters (used when switching modes)
  const translateAllChapters = async () => {
    chaptersRef.current.forEach((chap, idx) => {
      if (chap.translatedParagraphs.length === 0 && !chap.isTranslating) {
        translateChapter(idx);
      }
    });
  };

  // Fetch initial chapter
  const fetchInitialChapter = async (url: string) => {
    setInitialLoading(true);
    setError('');
    stopSpeaking();
    setAutoScrollSpeed(0);

    try {
      const res = await fetch(`/api/fetch-novel?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error('Failed to retrieve novel content from server.');
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newChap: ChapterItem = {
        id: url,
        url,
        title: data.title || 'Untitled Chapter',
        bookTitle: data.bookTitle || 'Novel',
        paragraphs: data.paragraphs || [],
        translatedParagraphs: [],
        prevUrl: data.prevUrl || '',
        nextUrl: data.nextUrl || '',
        indexUrl: data.indexUrl || '',
      };

      setChapters([newChap]);
      setActiveChapterIndex(0);
      saveToHistory(url, newChap.title, newChap.bookTitle);

      // If translation mode is active, trigger translation immediately
      if (translationModeRef.current !== 'zh') {
        setTimeout(() => translateChapter(0), 100);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Error occurred while loading chapter.');
    } finally {
      setInitialLoading(false);
    }
  };

  // Fetch and append the next chapter (Auto Continue)
  const fetchNextChapter = useCallback(async (nextUrlToFetch: string) => {
    if (loadingNext || !nextUrlToFetch) return;
    setLoadingNext(true);

    try {
      const res = await fetch(`/api/fetch-novel?url=${encodeURIComponent(nextUrlToFetch)}`);
      if (!res.ok) throw new Error('Failed to fetch next chapter.');
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const nextChap: ChapterItem = {
        id: nextUrlToFetch,
        url: nextUrlToFetch,
        title: data.title || 'Next Chapter',
        bookTitle: data.bookTitle || chaptersRef.current[0]?.bookTitle || 'Novel',
        paragraphs: data.paragraphs || [],
        translatedParagraphs: [],
        prevUrl: data.prevUrl || '',
        nextUrl: data.nextUrl || '',
        indexUrl: data.indexUrl || '',
      };

      setChapters(prev => [...prev, nextChap]);
      const newIndex = chaptersRef.current.length; // index of new chapter

      // Auto translate if active mode is English or bilingual
      if (translationModeRef.current !== 'zh') {
        setTimeout(() => translateChapter(newIndex), 100);
      }
    } catch (e) {
      console.error('Failed to auto-load next chapter', e);
    } finally {
      setLoadingNext(false);
    }
  }, [loadingNext]);

  // Load initial URL on mount or URL change
  useEffect(() => {
    if (targetUrl) {
      fetchInitialChapter(targetUrl);
    }
  }, [targetUrl]);

  // Sentinel IntersectionObserver for infinite scrolling / auto continue
  useEffect(() => {
    if (!autoContinue) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        const [entry] = entries;
        if (entry.isIntersecting && !loadingNext && chaptersRef.current.length > 0) {
          const lastChap = chaptersRef.current[chaptersRef.current.length - 1];
          if (lastChap && lastChap.nextUrl) {
            fetchNextChapter(lastChap.nextUrl);
          }
        }
      },
      { rootMargin: '1000px 0px 500px 0px' } // Pre-fetch 1000px before reaching the end
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoContinue, loadingNext, fetchNextChapter]);

  // Track active chapter in viewport to update URL and history
  useEffect(() => {
    const handleScroll = () => {
      const chapterEls = document.querySelectorAll('[data-chapter-idx]');
      const scrollPos = window.scrollY + 200;

      chapterEls.forEach(el => {
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const height = rect.height;
        if (scrollPos >= top && scrollPos < top + height) {
          const idx = Number(el.getAttribute('data-chapter-idx'));
          if (!isNaN(idx) && idx !== activeChapterIndex && chaptersRef.current[idx]) {
            setActiveChapterIndex(idx);
            const activeChap = chaptersRef.current[idx];
            // Sync browser URL without reloading
            window.history.replaceState(null, '', `/reader?url=${encodeURIComponent(activeChap.url)}`);
            saveToHistory(activeChap.url, activeChap.title, activeChap.bookTitle);
          }
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [activeChapterIndex]);

  // Auto Scroll Engine
  useEffect(() => {
    if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);

    if (autoScrollSpeed > 0) {
      const intervalMs = Math.max(16, 120 - autoScrollSpeed * 20);
      scrollIntervalRef.current = setInterval(() => {
        window.scrollBy({ top: 1, behavior: 'auto' });
      }, intervalMs);
    }

    return () => {
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    };
  }, [autoScrollSpeed]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        // Toggle auto-scroll pause/resume
        setAutoScrollSpeed(prev => (prev > 0 ? 0 : 2));
      } else if (e.key === 'ArrowRight') {
        const lastChap = chaptersRef.current[chaptersRef.current.length - 1];
        if (lastChap && lastChap.nextUrl) {
          fetchNextChapter(lastChap.nextUrl);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fetchNextChapter]);

  // -------------------------------------------------------------
  // Voice Mode / Text-To-Speech (TTS) Architecture
  // -------------------------------------------------------------
  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (cloudAudioRef.current) {
      cloudAudioRef.current.pause();
      cloudAudioRef.current = null;
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setActiveSpeechLoc(null);
  };

  const pauseSpeaking = () => {
    if (ttsEngine === 'device' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    } else if (cloudAudioRef.current) {
      cloudAudioRef.current.pause();
    }
    setIsPaused(true);
  };

  const resumeSpeaking = () => {
    if (ttsEngine === 'device' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    } else if (cloudAudioRef.current) {
      cloudAudioRef.current.play();
    }
    setIsPaused(false);
  };

  // Speak paragraph with auto-continue to next paragraph & next chapter
  const speakParagraph = (chapterIdx: number, paraIdx: number) => {
    stopSpeaking();
    setAutoScrollSpeed(0); // Pause auto-scroll to avoid conflict

    const currentChaps = chaptersRef.current;
    if (chapterIdx < 0 || chapterIdx >= currentChaps.length) {
      stopSpeaking();
      return;
    }

    const chap = currentChaps[chapterIdx];
    const isEn = translationModeRef.current !== 'zh';
    const paragraphs = (isEn && chap.translatedParagraphs.length > 0)
      ? chap.translatedParagraphs
      : chap.paragraphs;

    // Check if finished current chapter
    if (paraIdx >= paragraphs.length) {
      // Transition to next chapter!
      if (chapterIdx + 1 < currentChaps.length) {
        speakParagraph(chapterIdx + 1, 0);
        return;
      } else if (chap.nextUrl && autoContinue) {
        // Automatically load next chapter and continue speaking
        fetchNextChapter(chap.nextUrl).then(() => {
          setTimeout(() => {
            speakParagraph(chapterIdx + 1, 0);
          }, 800);
        });
        return;
      } else {
        stopSpeaking();
        return;
      }
    }

    const textToSpeak = paragraphs[paraIdx];
    if (!textToSpeak || !textToSpeak.trim()) {
      // Skip empty line
      speakParagraph(chapterIdx, paraIdx + 1);
      return;
    }

    setActiveSpeechLoc({ chapterIdx, paraIdx });
    setIsSpeaking(true);
    setIsPaused(false);

    // Smoothly scroll active paragraph to center of viewport
    const elementId = `para-${chapterIdx}-${paraIdx}`;
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Engine 1: In-Device TTS (Offline Web Speech API)
    if (ttsEngine === 'device') {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        alert('Device Web Speech API is not supported in this browser.');
        stopSpeaking();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = speechRate;
      utterance.pitch = speechPitch;

      if (selectedVoice) {
        const v = voices.find(voice => voice.name === selectedVoice);
        if (v) utterance.voice = v;
      }

      utterance.onend = () => {
        speakParagraph(chapterIdx, paraIdx + 1);
      };

      utterance.onerror = (e) => {
        console.error('TTS utterance error:', e);
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    }
    // Engine 2: Cloud Neural TTS Stream (/api/tts)
    else {
      const lang = isEn ? 'en' : 'zh-CN';
      const audioUrl = `/api/tts?text=${encodeURIComponent(textToSpeak)}&lang=${lang}`;
      const audio = new Audio(audioUrl);
      cloudAudioRef.current = audio;
      audio.playbackRate = speechRate;

      audio.onended = () => {
        speakParagraph(chapterIdx, paraIdx + 1);
      };

      audio.onerror = () => {
        console.warn('Cloud TTS error, falling back to in-device TTS for this paragraph.');
        setTtsEngine('device');
        speakParagraph(chapterIdx, paraIdx);
      };

      audio.play().catch(e => {
        console.error('Audio play failed:', e);
        setIsSpeaking(false);
      });
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    };
  }, []);

  const activeChap = chapters[activeChapterIndex] || chapters[0];
  const currentDisplayTitle = activeChap
    ? (translationMode === 'en' && activeChap.translatedTitle ? activeChap.translatedTitle : activeChap.title)
    : 'Novel Reader';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontSize: `${fontSize}px`,
      background: 'var(--bg-color)',
      color: 'var(--text-color)',
      transition: 'background-color 0.3s ease, color 0.3s ease'
    }}>
      {/* Top Navigation & Controls HUD */}
      <header className="glass" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        padding: '0.65rem 1.25rem',
        margin: 0,
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.875rem',
      }}>
        {/* Left: Library Link & Chapter Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <Link href="/" style={{
            textDecoration: 'none',
            color: 'var(--text-color)',
            fontWeight: 700,
            opacity: 0.85,
            fontSize: '0.85rem',
            whiteSpace: 'nowrap'
          }}>
            ◀ Library
          </Link>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span className="header-title" style={{
            fontWeight: 600,
            color: 'var(--text-color)',
            opacity: 0.7,
            maxWidth: '220px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }} title={currentDisplayTitle}>
            {currentDisplayTitle}
          </span>
          {chapters.length > 1 && (
            <span style={{
              fontSize: '0.7rem',
              padding: '2px 8px',
              borderRadius: '999px',
              background: 'rgba(var(--accent-color), 0.1)',
              color: 'var(--accent-color)',
              fontWeight: 600
            }}>
              Ch {activeChapterIndex + 1}/{chapters.length} loaded
            </span>
          )}
        </div>

        {/* Center: Translation Mode Quick Selector */}
        <div className="desktop-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            display: 'inline-flex',
            background: 'rgba(0, 0, 0, 0.06)',
            borderRadius: '10px',
            padding: '3px',
            border: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setTranslationMode('zh')}
              style={{
                background: translationMode === 'zh' ? 'var(--panel-bg)' : 'transparent',
                color: 'var(--text-color)',
                border: 'none',
                borderRadius: '7px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: translationMode === 'zh' ? 700 : 500,
                cursor: 'pointer',
                boxShadow: translationMode === 'zh' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
              }}
            >
              🇨🇳 Raw
            </button>
            <button
              onClick={() => {
                setTranslationMode('en');
                translateAllChapters();
              }}
              style={{
                background: translationMode === 'en' ? 'var(--panel-bg)' : 'transparent',
                color: 'var(--text-color)',
                border: 'none',
                borderRadius: '7px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: translationMode === 'en' ? 700 : 500,
                cursor: 'pointer',
                boxShadow: translationMode === 'en' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
              }}
            >
              🇺🇸 English
            </button>
            <button
              onClick={() => {
                setTranslationMode('bilingual');
                translateAllChapters();
              }}
              style={{
                background: translationMode === 'bilingual' ? 'var(--panel-bg)' : 'transparent',
                color: 'var(--text-color)',
                border: 'none',
                borderRadius: '7px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: translationMode === 'bilingual' ? 700 : 500,
                cursor: 'pointer',
                boxShadow: translationMode === 'bilingual' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
              }}
            >
              🌐 Bilingual
            </button>
          </div>

          {/* Auto Continue / Infinite Scroll Pill */}
          <button
            onClick={() => setAutoContinue(!autoContinue)}
            style={{
              background: autoContinue ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.1)',
              color: autoContinue ? '#059669' : 'inherit',
              border: `1px solid ${autoContinue ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
              borderRadius: '8px',
              padding: '5px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Automatically load subsequent chapters as you scroll"
          >
            {autoContinue ? '⚡ Auto-Continue ON' : 'Manual Paging'}
          </button>
        </div>

        {/* Right: TTS Voice Mode & Auto Scroll Controls & Settings Drawer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* TTS Voice Mode Mini Controller */}
          {isSpeaking ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(211, 84, 0, 0.1)',
              border: '1px solid rgba(211, 84, 0, 0.3)',
              borderRadius: '8px',
              padding: '3px 8px'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-color)' }}>
                🔊 Voice
              </span>
              <button
                onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.9rem'
                }}
                title={isPaused ? 'Resume Voice' : 'Pause Voice'}
              >
                {isPaused ? '▶' : '⏸'}
              </button>
              <button
                onClick={stopSpeaking}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.85rem'
                }}
                title="Stop Voice"
              >
                ⏹
              </button>
            </div>
          ) : (
            <button
              onClick={() => speakParagraph(activeChapterIndex, 0)}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '5px 10px',
                cursor: 'pointer',
                color: 'var(--text-color)',
                fontSize: '0.75rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Start Voice Reading (Text-to-Speech)"
            >
              🔊 Voice Mode
            </button>
          )}

          {/* Auto Scroll Speed Dropdown */}
          <div className="desktop-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Scroll:</span>
            <select
              value={autoScrollSpeed}
              onChange={(e) => setAutoScrollSpeed(Number(e.target.value))}
              style={{
                background: 'var(--panel-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '4px 6px',
                fontSize: '0.75rem',
                outline: 'none',
                cursor: 'pointer'
              }}
              title="Continuous Auto-Reading Scroll Speed"
            >
              <option value={0}>Off</option>
              <option value={1}>1x Slow</option>
              <option value={2}>2x Normal</option>
              <option value={3}>3x Fast</option>
              <option value={4}>4x Very Fast</option>
              <option value={5}>5x Ultra</option>
            </select>
          </div>

          {/* Settings Drawer Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: showSettings ? 'var(--accent-color)' : 'none',
              color: showSettings ? '#fff' : 'var(--text-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '5px 10px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            ⚙ Settings
          </button>
        </div>
      </header>

      {/* Slide-out Settings & Voice Configuration Drawer */}
      {showSettings && (
        <div className="glass" style={{
          position: 'fixed',
          top: '55px',
          right: '15px',
          zIndex: 200,
          width: '330px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.1rem',
          fontSize: '0.85rem',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontWeight: 700, fontSize: '1rem' }}>Reader Preferences</h4>
            <button
              onClick={() => setShowSettings(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-color)', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              ✕
            </button>
          </div>

          {/* Theme Switcher */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', opacity: 0.7, fontWeight: 600 }}>THEME</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {[
                { id: 'sepia', label: 'Sepia', bg: '#f7f1e3', color: '#2c251d' },
                { id: 'light', label: 'Light', bg: '#ffffff', color: '#111827' },
                { id: 'dark', label: 'Dark', bg: '#0f172a', color: '#f8fafc' },
                { id: 'mint', label: 'Mint', bg: '#edf5f1', color: '#1e352b' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id as any)}
                  style={{
                    background: t.bg,
                    color: t.color,
                    border: theme === t.id ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.75rem', opacity: 0.7, fontWeight: 600 }}>FONT SIZE</label>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fontSize}px</span>
            </div>
            <input
              type="range"
              min="16"
              max="32"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-color)' }}
            />
          </div>

          {/* Layout Mode Toggle */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', opacity: 0.7, fontWeight: 600 }}>LAYOUT</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                onClick={() => setLayoutMode('single')}
                style={{
                  background: layoutMode === 'single' ? 'var(--accent-color)' : 'var(--panel-bg)',
                  color: layoutMode === 'single' ? '#fff' : 'inherit',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Single Column
              </button>
              <button
                onClick={() => setLayoutMode('dual')}
                style={{
                  background: layoutMode === 'dual' ? 'var(--accent-color)' : 'var(--panel-bg)',
                  color: layoutMode === 'dual' ? '#fff' : 'inherit',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Dual Column
              </button>
            </div>
          </div>

          {/* Voice Mode Configuration */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', opacity: 0.7, fontWeight: 600 }}>
              VOICE MODE (TTS ENGINE)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <button
                onClick={() => setTtsEngine('device')}
                style={{
                  background: ttsEngine === 'device' ? 'var(--accent-color)' : 'var(--panel-bg)',
                  color: ttsEngine === 'device' ? '#fff' : 'inherit',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                In-Device (Offline)
              </button>
              <button
                onClick={() => setTtsEngine('cloud')}
                style={{
                  background: ttsEngine === 'cloud' ? 'var(--accent-color)' : 'var(--panel-bg)',
                  color: ttsEngine === 'cloud' ? '#fff' : 'inherit',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cloud Stream
              </button>
            </div>

            {/* Voice dropdown for In-Device TTS */}
            {ttsEngine === 'device' && voices.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.7rem', opacity: 0.6 }}>Voice Selection:</label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--panel-bg)',
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '6px',
                    fontSize: '0.75rem',
                    outline: 'none'
                  }}
                >
                  {voices.map(v => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Voice Speed (Up to 3x) */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Voice Speed:</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-color)' }}>{speechRate.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-color)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', gap: '4px' }}>
                {[0.75, 1.0, 1.5, 2.0, 2.5, 3.0].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSpeechRate(rate)}
                    style={{
                      background: speechRate === rate ? 'var(--accent-color)' : 'var(--panel-bg)',
                      color: speechRate === rate ? '#fff' : 'inherit',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      padding: '2px 3px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      flex: 1,
                      textAlign: 'center'
                    }}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Pitch */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Voice Pitch:</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{speechPitch.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.1"
                value={speechPitch}
                onChange={(e) => setSpeechPitch(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-color)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', opacity: 0.5 }}>
                <span>Deeper (0.5x)</span>
                <span>Normal (1.0x)</span>
                <span>Higher (1.8x)</span>
              </div>
            </div>
          </div>

          {/* Infinite Scroll / Auto Continue Toggle */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Auto Continue</span>
                <p style={{ fontSize: '0.7rem', opacity: 0.6, margin: 0 }}>Load next chapter on scroll</p>
              </div>
              <input
                type="checkbox"
                checked={autoContinue}
                onChange={(e) => setAutoContinue(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)' }}
              />
            </label>
          </div>
        </div>
      )}

      {/* Main Viewport Content */}
      <main style={{ flex: 1, paddingBottom: '5rem' }}>
        {initialLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            gap: '1rem'
          }}>
            <div style={{
              width: '42px',
              height: '42px',
              border: '3px solid var(--border-color)',
              borderTopColor: 'var(--accent-color)',
              borderRadius: '50%',
              animation: 'spin 0.9s linear infinite'
            }} />
            <p style={{ opacity: 0.75, fontSize: '0.95rem' }}>Decrypting & parsing chapter...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div className="glass" style={{
            maxWidth: '520px',
            margin: '4rem auto',
            padding: '2.5rem',
            textAlign: 'center',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            background: 'rgba(239, 68, 68, 0.05)'
          }}>
            <h3 style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '1.25rem' }}>⚠️ Parsing Failed</h3>
            <p style={{ opacity: 0.8, fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>{error}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button onClick={() => targetUrl && fetchInitialChapter(targetUrl)} className="btn-primary">
                🔄 Retry
              </button>
              <Link href="/" className="btn-secondary">
                Back to Library
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: layoutMode === 'dual' ? '1200px' : '820px', margin: '0 auto', padding: '0 1rem' }}>
            {/* Chapters List (Continuous Infinite Reading) */}
            {chapters.map((chapter, chapIdx) => {
              const displayTitle = translationMode === 'en' && chapter.translatedTitle
                ? chapter.translatedTitle
                : translationMode === 'bilingual' && chapter.translatedTitle
                ? `${chapter.title} / ${chapter.translatedTitle}`
                : chapter.title;

              return (
                <article
                  key={chapter.id || chapIdx}
                  data-chapter-idx={chapIdx}
                  className="animate-fade-in"
                  style={{
                    marginBottom: '4rem',
                    borderBottom: chapIdx < chapters.length - 1 ? '1px dashed var(--border-color)' : 'none',
                    paddingBottom: '3rem'
                  }}
                >
                  {/* Chapter Header Card */}
                  <div style={{
                    textAlign: 'center',
                    margin: '3rem auto 2.5rem',
                    padding: '1.5rem',
                    borderRadius: '16px',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)'
                  }}>
                    {chapter.bookTitle && (
                      <p style={{ fontSize: '0.8rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem' }}>
                        {chapter.bookTitle}
                      </p>
                    )}
                    <h1 style={{
                      fontSize: '2rem',
                      fontWeight: 800,
                      color: 'var(--text-color)',
                      marginBottom: '0.75rem',
                      lineHeight: 1.25,
                      fontFamily: 'var(--font-title)'
                    }}>
                      {displayTitle}
                    </h1>

                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', fontSize: '0.8rem', opacity: 0.65 }}>
                      <span>Chapter {chapIdx + 1} of {chapters.length} loaded</span>
                      <span>·</span>
                      <a href={chapter.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                        Source
                      </a>
                      {chapter.translatedParagraphs.length === 0 && (
                        <>
                          <span>·</span>
                          <button
                            onClick={() => translateChapter(chapIdx)}
                            disabled={chapter.isTranslating}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--accent-color)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'underline'
                            }}
                          >
                            {chapter.isTranslating ? 'Translating...' : 'Translate to English'}
                          </button>
                        </>
                      )}
                      <span>·</span>
                      <button
                        onClick={() => speakParagraph(chapIdx, 0)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-color)',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        🔊 Listen
                      </button>
                    </div>
                  </div>

                  {/* Chapter Content Layout */}
                  {layoutMode === 'dual' ? (
                    /* Dual Column Layout: Left Original Chinese, Right English */
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                      {/* Left: Original Chinese */}
                      <div className="glass" style={{ padding: '2rem 1.5rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                        <h4 style={{ marginBottom: '1.5rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                          中文原文
                        </h4>
                        {chapter.paragraphs.map((para, pIdx) => {
                          const isCurrentActive = activeSpeechLoc?.chapterIdx === chapIdx && activeSpeechLoc?.paraIdx === pIdx;
                          return (
                            <p
                              key={pIdx}
                              id={`para-${chapIdx}-${pIdx}`}
                              onClick={() => speakParagraph(chapIdx, pIdx)}
                              style={{
                                fontFamily: 'var(--font-body-cn)',
                                textIndent: '2em',
                                marginBottom: '1.25em',
                                lineHeight: 1.8,
                                padding: '4px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                backgroundColor: isCurrentActive ? 'rgba(211, 84, 0, 0.15)' : 'transparent',
                                transition: 'background-color 0.25s ease'
                              }}
                              title="Click to speak from this paragraph"
                            >
                              {para}
                            </p>
                          );
                        })}
                      </div>

                      {/* Right: English Translation */}
                      <div className="glass" style={{ padding: '2rem 1.5rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                        <h4 style={{ marginBottom: '1.5rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                          English Translation
                        </h4>
                        {chapter.translatedParagraphs.length > 0 ? (
                          chapter.translatedParagraphs.map((para, pIdx) => {
                            const isCurrentActive = activeSpeechLoc?.chapterIdx === chapIdx && activeSpeechLoc?.paraIdx === pIdx;
                            return (
                              <p
                                key={pIdx}
                                onClick={() => speakParagraph(chapIdx, pIdx)}
                                style={{
                                  fontFamily: 'var(--font-body-en)',
                                  marginBottom: '1.25em',
                                  lineHeight: 1.7,
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  backgroundColor: isCurrentActive ? 'rgba(211, 84, 0, 0.15)' : 'transparent',
                                  transition: 'background-color 0.25s ease'
                                }}
                                title="Click to speak from this paragraph"
                              >
                                {para}
                              </p>
                            );
                          })
                        ) : (
                          <div style={{ textAlign: 'center', padding: '4rem 1rem', opacity: 0.7 }}>
                            <p style={{ marginBottom: '1rem' }}>No translation ready for this chapter yet.</p>
                            <button
                              onClick={() => translateChapter(chapIdx)}
                              disabled={chapter.isTranslating}
                              className="btn-primary"
                            >
                              {chapter.isTranslating ? 'Translating...' : 'Translate to English'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Single Column Layout */
                    <div className="glass" style={{ padding: '2.5rem 2rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                      {/* Chinese Only */}
                      {translationMode === 'zh' && (
                        <div>
                          {chapter.paragraphs.map((para, pIdx) => {
                            const isCurrentActive = activeSpeechLoc?.chapterIdx === chapIdx && activeSpeechLoc?.paraIdx === pIdx;
                            return (
                              <p
                                key={pIdx}
                                id={`para-${chapIdx}-${pIdx}`}
                                onClick={() => speakParagraph(chapIdx, pIdx)}
                                style={{
                                  fontFamily: 'var(--font-body-cn)',
                                  textIndent: '2em',
                                  marginBottom: '1.25em',
                                  lineHeight: 1.85,
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  backgroundColor: isCurrentActive ? 'rgba(211, 84, 0, 0.15)' : 'transparent',
                                  transition: 'background-color 0.25s ease'
                                }}
                                title="Click to listen from this paragraph"
                              >
                                {para}
                              </p>
                            );
                          })}
                        </div>
                      )}

                      {/* English Only */}
                      {translationMode === 'en' && (
                        <div>
                          {chapter.translatedParagraphs.length > 0 ? (
                            chapter.translatedParagraphs.map((para, pIdx) => {
                              const isCurrentActive = activeSpeechLoc?.chapterIdx === chapIdx && activeSpeechLoc?.paraIdx === pIdx;
                              return (
                                <p
                                  key={pIdx}
                                  id={`para-${chapIdx}-${pIdx}`}
                                  onClick={() => speakParagraph(chapIdx, pIdx)}
                                  style={{
                                    fontFamily: 'var(--font-body-en)',
                                    marginBottom: '1.25em',
                                    lineHeight: 1.75,
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    backgroundColor: isCurrentActive ? 'rgba(211, 84, 0, 0.15)' : 'transparent',
                                    transition: 'background-color 0.25s ease'
                                  }}
                                  title="Click to listen from this paragraph"
                                >
                                  {para}
                                </p>
                              );
                            })
                          ) : (
                            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', opacity: 0.7 }}>
                              <p style={{ marginBottom: '1rem' }}>Translating to English...</p>
                              <button
                                onClick={() => translateChapter(chapIdx)}
                                disabled={chapter.isTranslating}
                                className="btn-primary"
                              >
                                {chapter.isTranslating ? 'Translating content...' : 'Load Translation'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Bilingual Stacked Mode */}
                      {translationMode === 'bilingual' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                          {chapter.paragraphs.map((para, pIdx) => {
                            const isCurrentActive = activeSpeechLoc?.chapterIdx === chapIdx && activeSpeechLoc?.paraIdx === pIdx;
                            const translatedPara = chapter.translatedParagraphs[pIdx];

                            return (
                              <div
                                key={pIdx}
                                id={`para-${chapIdx}-${pIdx}`}
                                onClick={() => speakParagraph(chapIdx, pIdx)}
                                style={{
                                  borderLeft: `3px solid ${isCurrentActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                  paddingLeft: '1.2rem',
                                  paddingTop: '6px',
                                  paddingBottom: '6px',
                                  borderRadius: '0 8px 8px 0',
                                  backgroundColor: isCurrentActive ? 'rgba(211, 84, 0, 0.08)' : 'transparent',
                                  cursor: 'pointer',
                                  transition: 'all 0.25s ease'
                                }}
                                title="Click to listen from this paragraph"
                              >
                                <p style={{
                                  fontFamily: 'var(--font-body-cn)',
                                  opacity: 0.65,
                                  fontSize: '0.9em',
                                  marginBottom: '0.4rem',
                                  lineHeight: 1.6
                                }}>
                                  {para}
                                </p>
                                <p style={{
                                  fontFamily: 'var(--font-body-en)',
                                  fontWeight: 500,
                                  lineHeight: 1.7
                                }}>
                                  {translatedPara || (chapter.isTranslating ? 'Translating...' : '...')}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {/* Bottom Infinite Scroll Sentinel & Next Chapter Trigger */}
            <div ref={sentinelRef} style={{ padding: '2rem 0', textAlign: 'center' }}>
              {loadingNext ? (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 24px',
                  borderRadius: '999px',
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid var(--border-color)',
                    borderTopColor: 'var(--accent-color)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Loading next chapter automatically...</span>
                </div>
              ) : chapters.length > 0 && chapters[chapters.length - 1].nextUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <button
                    onClick={() => fetchNextChapter(chapters[chapters.length - 1].nextUrl)}
                    className="btn-primary"
                    style={{ padding: '12px 32px' }}
                  >
                    Load Next Chapter ▶
                  </button>
                  <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                    {autoContinue ? '⚡ Auto-continue is active — chapter will also load when you scroll here' : 'Auto-continue is OFF. Click button to load next chapter.'}
                  </p>
                </div>
              ) : chapters.length > 0 ? (
                <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>🎉 You have reached the latest released chapter!</p>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {/* Floating Speed / Pause Badge during Auto-Scroll */}
      {autoScrollSpeed > 0 && (
        <div className="glass" style={{
          position: 'fixed',
          bottom: '25px',
          right: '25px',
          zIndex: 90,
          padding: '8px 16px',
          borderRadius: '999px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)'
        }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
            ⚡ Auto-Reading ({autoScrollSpeed}x)
          </span>
          <button
            onClick={() => setAutoScrollSpeed(0)}
            style={{
              background: 'var(--accent-color)',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              padding: '2px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Pause
          </button>
        </div>
      )}
    </div>
  );
}
