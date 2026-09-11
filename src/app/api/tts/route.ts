import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function fetchTtsChunk(text: string, lang: string): Promise<Uint8Array | null> {
  if (!text || !text.trim()) return null;
  const cleanText = text.trim().slice(0, 350);
  const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;

  try {
    const res = await fetch(googleTtsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      }
    });

    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.error('Error fetching TTS chunk:', e);
    return null;
  }
}

// GET: Single paragraph TTS audio stream
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text');
  const lang = searchParams.get('lang') || 'en';

  if (!text) {
    return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
  }

  const chunk = await fetchTtsChunk(text, lang);
  if (!chunk) {
    return NextResponse.json({ error: 'Failed to fetch TTS audio stream' }, { status: 500 });
  }

  return new Response(chunk, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

// POST: On-the-fly Full Chapter Audiobook Generator & MP3 Exporter
export async function POST(request: Request) {
  try {
    const { paragraphs, title = 'Chapter_Audiobook', lang = 'en', download = false } = await request.json();

    if (!paragraphs || !Array.isArray(paragraphs) || paragraphs.length === 0) {
      return NextResponse.json({ error: 'paragraphs array is required' }, { status: 400 });
    }

    const audioBuffers: Uint8Array[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
      const batch = paragraphs.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(p => fetchTtsChunk(p, lang))
      );

      for (const b of batchResults) {
        if (b) audioBuffers.push(b);
      }
    }

    if (audioBuffers.length === 0) {
      return NextResponse.json({ error: 'Failed to generate chapter audiobook' }, { status: 500 });
    }

    // Concatenate all paragraph MP3 buffers into a single full-chapter audiobook file
    const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    const safeTitle = title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 50);
    const filename = `${safeTitle}_Audiobook.mp3`;

    return new Response(combined, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(combined.length),
        'Content-Disposition': download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });

  } catch (error: any) {
    console.error('Chapter audiobook error:', error);
    return NextResponse.json({ error: error.message || 'Audiobook generation failed' }, { status: 500 });
  }
}
