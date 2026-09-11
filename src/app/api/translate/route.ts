import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DELIM = '\n\n<<<P_BREAK>>>\n\n';

async function translateBatch(paragraphs: string[], sl: string = 'zh-CN', tl: string = 'en'): Promise<string[]> {
  if (!paragraphs || paragraphs.length === 0) return [];

  const joined = paragraphs.join(DELIM);
  const containsChinese = /[\u4e00-\u9fa5]/.test(joined);
  const effectiveSl = (sl === 'auto' && containsChinese) ? 'zh-CN' : (sl || 'zh-CN');

  // Primary: Google Chrome extension client (extremely fast, stable, and unblocked)
  const primaryUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${effectiveSl}&tl=${tl}&q=${encodeURIComponent(joined)}`;

  try {
    const response = await fetch(primaryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data[0]) {
        const fullTranslatedText = data[0];
        const parts = fullTranslatedText.split(/<<<P_BREAK>>>/i).map((p: string) => p.trim());
        if (parts.length === paragraphs.length) {
          return parts;
        }
      }
    }
  } catch (e) {
    console.error('Primary batch translation error:', e);
  }

  // Secondary fallback: standard single API
  try {
    const fallbackUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${effectiveSl}&tl=${tl}&dt=t&q=${encodeURIComponent(joined)}`;
    const response = await fetch(fallbackUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (response.ok) {
      const result = await response.json();
      if (result && result[0]) {
        const fullTranslatedText = result[0].map((item: any) => item[0] || '').join('');
        const parts = fullTranslatedText.split(/<<<P_BREAK>>>/i).map((p: string) => p.trim());
        if (parts.length === paragraphs.length) {
          return parts;
        }
      }
    }
  } catch (e) {
    console.error('Secondary batch translation error:', e);
  }

  // Fallback: translate individually if batch delimiter mismatch
  const individualResults: string[] = [];
  for (const p of paragraphs) {
    if (!p.trim()) {
      individualResults.push('');
      continue;
    }
    const singleUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${effectiveSl}&tl=${tl}&q=${encodeURIComponent(p)}`;
    try {
      const r = await fetch(singleUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j) && j[0]) {
          individualResults.push(j[0]);
          continue;
        }
      }
    } catch {}
    individualResults.push(p);
  }
  return individualResults;
}

export async function POST(request: Request) {
  try {
    const { paragraphs, title, sourceLang = 'zh-CN', targetLang = 'en' } = await request.json();

    if ((!paragraphs || !Array.isArray(paragraphs)) && !title) {
      return NextResponse.json({ error: 'paragraphs array or title is required' }, { status: 400 });
    }

    let translatedTitle = '';
    if (title) {
      const titleRes = await translateBatch([title], sourceLang, targetLang);
      translatedTitle = titleRes[0] || title;
    }

    const translatedParagraphs: string[] = [];
    if (paragraphs && Array.isArray(paragraphs) && paragraphs.length > 0) {
      const BATCH_SIZE = 12;

      for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
        const batch = paragraphs.slice(i, i + BATCH_SIZE);
        const batchTranslations = await translateBatch(batch, sourceLang, targetLang);
        translatedParagraphs.push(...batchTranslations);
      }
    }

    return NextResponse.json({ translatedParagraphs, translatedTitle });

  } catch (error: any) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: error.message || 'Failed to translate' }, { status: 500 });
  }
}
