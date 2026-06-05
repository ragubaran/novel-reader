import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

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
    
    // First try utf-8
    let html = new TextDecoder('utf-8').decode(buffer);
    
    // Check if charset is GBK or GB2312
    if (/charset=["']?(gbk|gb2312|gb18030)/i.test(html) || /charset=["']?(GBK|GB2312|GB18030)/.test(html)) {
      try {
        html = new TextDecoder('gbk').decode(buffer);
      } catch (e) {
        console.error('Failed to decode as GBK, falling back to UTF-8:', e);
      }
    }

    const $ = cheerio.load(html);

    // 1. Try to find the title
    let title = '';
    const titleSelectors = ['h1', '.title', '.bookname h1', '.chaptername', '.nr_title', '.title h1'];
    for (const sel of titleSelectors) {
      const text = $(sel).first().text().trim();
      if (text) {
        title = text;
        break;
      }
    }
    if (!title) {
      title = $('title').text().split('_')[0].split(',')[0].trim();
    }

    // 2. Extract content text
    let contentParagraphs: string[] = [];
    const contentSelectors = ['#content', '#nr1', '#txt', '.content', '.chaptercontent', '#htmlcontent', '#article', '#BookText', '.read-content'];
    
    let contentContainer: cheerio.Cheerio<any> | null = null;
    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length > 0) {
        contentContainer = el;
        break;
      }
    }

    if (contentContainer) {
      // Clean up ads and unwanted tags
      contentContainer.find('script, style, a, iframe, .ads, .adsbygoogle, #center_tip, .read_tips, .author-note, .recommend, div:not(#content)').remove();
      
      // Look for line breaks or paragraphs
      const htmlContent = contentContainer.html() || '';
      
      // Split by <br> or <p> tags
      const splitContent = htmlContent
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n');

      contentParagraphs = splitContent
        .map(p => {
          // Remove HTML tags
          let text = p.replace(/<[^>]*>/g, '').trim();
          // Entity decoding
          text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
          return text;
        })
        .filter(p => {
          // Filter out ads, empty lines, and system notifications
          if (!p) return false;
          if (p.includes('www.') || p.includes('.com') || p.includes('.net') || p.includes('.org')) return false;
          if (p.includes('上一章') || p.includes('下一章') || p.includes('目录') || p.includes('书页') || p.includes('存书签')) return false;
          if (p.includes('网页版') || p.includes('手机版') || p.includes('电脑版') || p.includes('临时书架')) return false;
          return p.length > 2; // skip tiny noises
        });
    }

    // 3. Find navigation links (Next, Previous, Index)
    let prevUrl = '';
    let nextUrl = '';
    let indexUrl = '';

    const resolveUrl = (relUrl: string) => {
      try {
        if (!relUrl) return '';
        return new URL(relUrl, targetUrl).href;
      } catch (e) {
        return relUrl;
      }
    };

    $('a').each((_, elem) => {
      const text = $(elem).text().trim();
      const href = $(elem).attr('href') || '';
      
      if (text.includes('上一章') || text.includes('上一页') || text.includes('Prev')) {
        prevUrl = resolveUrl(href);
      } else if (text.includes('下一章') || text.includes('下一页') || text.includes('Next')) {
        nextUrl = resolveUrl(href);
      } else if (text.includes('目录') || text.includes('书页') || text.includes('书 页') || text.includes('Index') || text.includes('List')) {
        indexUrl = resolveUrl(href);
      }
    });

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
