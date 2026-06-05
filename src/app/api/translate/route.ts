import { NextResponse } from 'next/server';

async function translateParagraph(text: string, sl: string = 'zh-CN', tl: string = 'en'): Promise<string> {
  if (!text.trim()) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return text;
    }

    const result = await response.json();
    if (result && result[0]) {
      return result[0].map((item: any) => item[0] || '').join('');
    }
  } catch (e) {
    console.error('Translation paragraph failure:', e);
  }
  return text;
}

export async function POST(request: Request) {
  try {
    const { paragraphs, title, sourceLang = 'zh-CN', targetLang = 'en' } = await request.json();

    if ((!paragraphs || !Array.isArray(paragraphs)) && !title) {
      return NextResponse.json({ error: 'paragraphs array or title is required' }, { status: 400 });
    }

    let translatedTitle = '';
    if (title) {
      translatedTitle = await translateParagraph(title, sourceLang, targetLang);
    }

    const translatedParagraphs: string[] = [];
    if (paragraphs && Array.isArray(paragraphs) && paragraphs.length > 0) {
      const BATCH_SIZE = 10;

      for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
        const batch = paragraphs.slice(i, i + BATCH_SIZE);
        const batchTranslations = await Promise.all(
          batch.map(p => translateParagraph(p, sourceLang, targetLang))
        );
        translatedParagraphs.push(...batchTranslations);
      }
    }

    return NextResponse.json({ translatedParagraphs, translatedTitle });

  } catch (error: any) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: error.message || 'Failed to translate' }, { status: 500 });
  }
}
