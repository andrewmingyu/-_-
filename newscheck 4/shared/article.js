export function isSupportedArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (['news.naver.com', 'n.news.naver.com'].includes(url.hostname)) {
      return /\/(?:mnews\/)?article\//.test(url.pathname);
    }
    if (['yonhapnewstv.co.kr', 'www.yonhapnewstv.co.kr'].includes(url.hostname)) {
      return /^\/news\/MYH[0-9A-Za-z_-]+\/?$/.test(url.pathname);
    }
    return false;
  } catch { return false; }
}

// 기사가 아닌 것이 분명한 페이지(검색 결과·영상·메신저·AI 채팅 등). 분석하면 엉뚱한 결과와 검색 크레딧만 쓰게 된다.
const NON_ARTICLE_HOSTS = ['search.naver.com', 'search.daum.net', 'www.bing.com', 'duckduckgo.com', 'claude.ai', 'chatgpt.com', 'gemini.google.com',
  'www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'github.com', 'mail.google.com', 'docs.google.com', 'web.whatsapp.com'];
export function isNonArticlePage(value) {
  try {
    const url = new URL(value);
    if (NON_ARTICLE_HOSTS.includes(url.hostname)) return true;
    if (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/search') return true;
    return false;
  } catch { return false; }
}

export function normalizeArticleUrl(value) {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('올바른 기사 URL이 필요합니다.');
  url.hash = '';
  const pairs = [...url.searchParams].filter(([key,value]) => value && !key.toLowerCase().startsWith('utm_') && key !== 'fbclid');
  pairs.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  url.search = ''; for (const [key,value] of pairs) url.searchParams.append(key,value);
  return url.href;
}
export function articleRequest(a, refresh = false) {
  const url = normalizeArticleUrl(a.url);
  return { url, title:a.title, page_text:a.body.replace(/\s+/g,' ').trim(), refresh,
    metadata:{url,title:a.title,publisher:a.press || null,author:a.reporters?.join(', ') || null,
      published_at:a.published || null,updated_at:a.modified || null,event_time:a.event_time || null,event_location:a.event_location || null,author_profile_url:null},
    article_context:a.article_context || {cited_links:[],quotations:[],body_truncated:false} };
}
export function previewFromAnalysis(a) {
  return {article_id:a.article_id,is_demo:a.is_demo,summary:a.one_line_summary,major_evidence:a.evidence_mentions.slice(0,2),
    sources:a.sources,claims:a.claims.slice(0,2),headline_difference:a.headline_difference,one_line_caution:a.caution.reasons[0],
    search_status:a.search_status,body_hash:a.body_hash,data_version:a.data_version,pipeline_errors:a.pipeline_errors || []};
}
