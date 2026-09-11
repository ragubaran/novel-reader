import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

// Helper to decrypt AES-GCM encrypted content used by sites like wtr-lab.com
async function decryptWtrLabBody(encrypted: string): Promise<string[]> {
  let isArr = false;
  let r = encrypted;
  if (r.startsWith('arr:')) {
    isArr = true;
    r = r.substring(4);
  } else if (r.startsWith('str:')) {
    r = r.substring(4);
  }

  const parts = r.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format from wtr-lab');
  }

  const [s, n, a] = parts;
  const iv = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(n), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(a), c => c.charCodeAt(0));
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const keyBytes = new TextEncoder().encode('IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru'.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  const text = new TextDecoder().decode(decrypted);

  if (isArr) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => String(item).trim()).filter(Boolean);
    }
    return [text];
  }

  return text.split('\n').map(p => p.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      next: { revalidate: 3600 } // Cache for 1 hour
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch novel page: ${res.statusText}` }, { status: 500 });
    }

    const buffer = await res.arrayBuffer();

    // Determine encoding from headers or HTML meta
    let html = new TextDecoder('utf-8').decode(buffer);
    const isGBK = /charset=["']?(gbk|gb2312|gb18030)/i.test(html) ||
                  res.headers.get('content-type')?.toLowerCase().includes('gbk') ||
                  res.headers.get('content-type')?.toLowerCase().includes('gb2312');

    if (isGBK) {
      try {
        html = new TextDecoder('gbk').decode(buffer);
      } catch (e) {
        console.error('Failed to decode as GBK, falling back to UTF-8:', e);
      }
    }

    const $ = cheerio.load(html);

    // ==========================================
    // 1. Specialized Handler: wtr-lab.com
    // ==========================================
    const isWtrLab = targetUrl.includes('wtr-lab.com') || $('#__NEXT_DATA__').length > 0;
    if (isWtrLab) {
      try {
        const nextDataRaw = $('#__NEXT_DATA__').html();
        if (nextDataRaw) {
          const nextData = JSON.parse(nextDataRaw);
          const serie = nextData?.props?.pageProps?.serie;
          const chapter = serie?.chapter;
          const serieData = serie?.serie_data;

          if (serieData && chapter) {
            const rawId = serieData.raw_id || chapter.raw_id;
            const order = chapter.order;
            const chapterId = chapter.id;
            const slug = serieData.slug || chapter.slug;
            const chapterCount = serieData.chapter_count || 999999;

            // Fetch decrypted content via wtr-lab internal API
            const wtrApiRes = await fetch('https://wtr-lab.com/api/reader/get', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              },
              body: JSON.stringify({
                raw_id: rawId,
                chapter_no: order,
                chapter_id: chapterId,
                language: 'en',
                translate: 'web'
              })
            });

            if (wtrApiRes.ok) {
              const wtrJson = await wtrApiRes.json();
              if (wtrJson.success && wtrJson.data?.data?.body) {
                const decryptedParagraphs = await decryptWtrLabBody(wtrJson.data.data.body);

                const bookTitle = serieData.data?.title || serieData.data?.raw?.title || 'Novel';
                const chapterTitle = wtrJson.chapter?.title || chapter.title || chapter.name || `Chapter ${order}`;
                const baseUrl = `https://wtr-lab.com/en/novel/${rawId}/${slug}`;

                const prevUrl = order > 1 ? `${baseUrl}/chapter-${order - 1}?service=web` : '';
                const nextUrl = order < chapterCount ? `${baseUrl}/chapter-${order + 1}?service=web` : '';
                const indexUrl = baseUrl;

                return NextResponse.json({
                  title: chapterTitle,
                  bookTitle,
                  paragraphs: decryptedParagraphs,
                  prevUrl,
                  nextUrl,
                  indexUrl,
                  originalUrl: targetUrl
                });
              }
            }
          }
        }
      } catch (wtrErr) {
        console.error('wtr-lab specific extraction failed, falling back to standard parsing:', wtrErr);
      }
    }

    // ==========================================
    // 2. Generic & Chinese Novel Site Scraper
    // ==========================================

    // Title Extraction
    let title = '';
    const titleSelectors = [
      'h1',
      '.title',
      '.bookname h1',
      '.chaptername',
      '.nr_title',
      '.title h1',
      '#title',
      '.chapter-title',
      '.entry-title'
    ];
    for (const sel of titleSelectors) {
      const text = $(sel).first().text().trim();
      if (text && text.length < 120) {
        title = text;
        break;
      }
    }
    if (!title) {
      title = $('title').text().split('_')[0].split(',')[0].split('-')[0].split('|')[0].trim();
    }

    // Content Extraction
    let contentParagraphs: string[] = [];
    const contentSelectors = [
      '#content',
      '#nr1',
      '#txt',
      '.content',
      '.chaptercontent',
      '#htmlcontent',
      '#article',
      '#BookText',
      '.read-content',
      'article',
      '.entry-content',
      '.reading-content',
      '.text-content',
      '#chapter-content',
      '.chapter-content',
      '.epcontent',
      '.post-body',
      'div[itemprop="articleBody"]',
      '.post-content',
      '.read_content',
      '.txt_cont',
      '#chapterContent',
      '.chapter-body'
    ];

    let contentContainer: cheerio.Cheerio<any> | null = null;
    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length > 0 && el.text().trim().length > 150) {
        contentContainer = el.first();
        break;
      }
    }

    // Fallback: If no standard selector matched, find element with largest text density
    if (!contentContainer) {
      let maxLen = 0;
      $('div, section').each((_, elem) => {
        const el = $(elem);
        // Exclude headers, footers, navs
        if (el.parents('header, footer, nav, aside').length > 0) return;
        const text = el.text().trim();
        if (text.length > maxLen && text.length > 200) {
          maxLen = text.length;
          contentContainer = el;
        }
      });
    }

    if (contentContainer) {
      // Clean up ads, scripts, buttons and unwanted noise
      contentContainer.find('script, style, a, iframe, .ads, .adsbygoogle, #center_tip, .read_tips, .author-note, .recommend, .pager, .tui, form, header, footer, nav').remove();

      const htmlContent = contentContainer.html() || '';

      // Normalize line breaks
      const splitContent = htmlContent
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<div[^>]*>/gi, '')
        .replace(/<\/div>/gi, '\n')
        .split('\n');

      contentParagraphs = splitContent
        .map(p => {
          let text = p.replace(/<[^>]*>/g, '').trim();
          text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&mdash;/g, '—');
          return text;
        })
        .filter(p => {
          if (!p) return false;
          // Filter ads and navigation noise
          if (p.includes('www.') || p.includes('.com') || p.includes('.net') || p.includes('.org') || p.includes('http')) return false;
          if (p.includes('上一章') || p.includes('下一章') || p.includes('目录') || p.includes('书页') || p.includes('存书签')) return false;
          if (p.includes('网页版') || p.includes('手机版') || p.includes('电脑版') || p.includes('临时书架')) return false;
          return p.length >= 2;
        });
    }

    // Navigation Links (Next, Previous, Index)
    let prevUrl = '';
    let nextUrl = '';
    let indexUrl = '';

    const resolveUrl = (relUrl: string) => {
      try {
        if (!relUrl || relUrl.startsWith('javascript:') || relUrl === '#') return '';
        return new URL(relUrl, targetUrl).href;
      } catch (e) {
        return relUrl;
      }
    };

    $('a').each((_, elem) => {
      const text = $(elem).text().trim().replace(/\s+/g, '');
      const href = $(elem).attr('href') || '';
      if (!href || href === '#' || href.startsWith('javascript:')) return;

      const fullUrl = resolveUrl(href);
      if (!fullUrl || fullUrl === targetUrl) return;

      if (
        text.includes('上一章') ||
        text.includes('上一页') ||
        text.includes('上一节') ||
        text === 'Prev' ||
        text === 'Previous' ||
        text.includes('PrevChapter')
      ) {
        prevUrl = fullUrl;
      } else if (
        text.includes('下一章') ||
        text.includes('下一页') ||
        text.includes('下一节') ||
        text === 'Next' ||
        text === 'NextChapter' ||
        text.includes('NextPage')
      ) {
        nextUrl = fullUrl;
      } else if (
        text.includes('目录') ||
        text.includes('书页') ||
        text.includes('章列表') ||
        text.includes('章节列表') ||
        text === 'Index' ||
        text === 'Contents' ||
        text === 'Catalog'
      ) {
        indexUrl = fullUrl;
      }
    });

    // If prevUrl is identical to indexUrl (e.g. Chapter 1 on m.ilwxs.com), clear it
    if (prevUrl && indexUrl && prevUrl === indexUrl) {
      prevUrl = '';
    }

    return NextResponse.json({
      title,
      paragraphs: contentParagraphs,
      prevUrl,
      nextUrl,
      indexUrl,
      originalUrl: targetUrl
    });

  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse novel content' }, { status: 500 });
  }
}
