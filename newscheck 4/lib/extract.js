// 이 파일의 함수들은 chrome.scripting.executeScript로 기사 페이지 안에서 실행됩니다.
// 그래서 바깥 변수를 참조하지 않는 독립 함수여야 합니다.

export function extractArticle(htmlText = null, pageUrl = null) {
  // Also used for a fetched Hover document; parsing never executes page scripts.
  const document = htmlText === null ? globalThis.document : new DOMParser().parseFromString(htmlText, 'text/html');
  const location = pageUrl === null ? globalThis.location : new URL(pageUrl);
  const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/ /g, " ").trim() : "");
  const meta = (...names) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
      if (el && el.content && el.content.trim()) return el.content.trim();
    }
    return "";
  };

  const host = location.hostname.replace(/^www\./, "");
  const structured = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    structured.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (value.mainEntity) visit(value.mainEntity);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try { if (script.textContent.length <= 200000) visit(JSON.parse(script.textContent)); } catch (_) {}
  });
  const articleData = structured.find(item => [item['@type']].flat().some(type => ['NewsArticle','Article','ReportageNewsArticle'].includes(type))) || {};

  // ---------- 언론사 ----------
  let press = meta("og:article:author", "og:site_name", "twitter:site", "application-name");
  press = press.replace(/\s*[|│]\s*네이버.*$/, "").replace(/^@/, "").trim();
  if ((!press || /네이버|naver/i.test(press)) && typeof articleData.publisher?.name==='string') press=articleData.publisher.name;
  const naverLogo = document.querySelector(".media_end_head_top_logo img, .press_logo img");
  if ((['news.naver.com','n.news.naver.com'].includes(host) || !press || /네이버|naver/i.test(press)) && naverLogo) press = naverLogo.alt || naverLogo.title || press;

  // ---------- 제목 ----------
  const headlineSelectors = [
    "h2.media_end_head_headline", "#title_area", ".media_end_head_headline",
    "h1.headline", "h1.article-title", "h1.title", ".article_title h1", ".article-head-title",
    "h1[itemprop='headline']", "[itemprop='headline']", "h3.tit_view", ".news_ttl", "h1",
  ];
  // 선택자로 찾은 제목이 og:title·페이지 제목과 비슷할 때만 채택한다 (배너·로고 h1 제외)
  const norm = (value) => String(value || '').replace(/[^0-9A-Za-z가-힣]/g, '');
  const refTitles = [
    meta("og:title", "twitter:title"),
    typeof articleData.headline === 'string' ? articleData.headline : '',
    document.title,
  ].map(norm).filter((value) => value.length >= 4);
  const matchesRef = (value) => {
    if (!refTitles.length) return true;
    const n = norm(value);
    const grams = [];
    for (let i = 0; i < n.length - 1; i++) grams.push(n.slice(i, i + 2));
    return grams.length > 0 && refTitles.some((r) => grams.filter((g) => r.includes(g)).length / grams.length >= 0.6);
  };
  let title = "";
  for (const s of headlineSelectors) {
    for (const el of document.querySelectorAll(s)) {
      const t = txt(el);
      if (t && t.length >= 8 && t.length <= 200 && matchesRef(t)) { title = t; break; }
    }
    if (title) break;
  }
  if (!title) {
    title = meta("og:title", "twitter:title") || (typeof articleData.headline==='string'?articleData.headline:'') || document.title;
    const site = meta("og:site_name");
    // "기사 제목 - 언론사명" 꼬리 제거
    title = title.replace(/\s*[-|:│]\s*([^-|:│]{1,20})$/, (m, tail) =>
      (site && tail.includes(site)) || /뉴스|신문|일보|방송|NEWS|타임스|헤럴드/i.test(tail) ? "" : m);
  }
  title = title.replace(/\s+/g, " ").trim();

  // ---------- 본문 ----------
  const bodySelectors = [
    "#dic_area", "#newsct_article", "#articleBodyContents", "#articeBody", "#article-view-content-div",
    "#articleBody", "#article_body", "#articletxt", "#newsEndContents", "#news_body_area",
    "[itemprop='articleBody']", ".article_body", ".article-body", ".art_body", ".news_body",
    ".article_txt", ".article-content", ".article_view", ".story-news", ".news_end", ".view_con",
    "article",
  ];
  let bodyEl = null;
  for (const s of bodySelectors) {
    const el = document.querySelector(s);
    if (el && txt(el).length > 200) { bodyEl = el; break; }
  }
  if (!bodyEl) {
    // <p>가 가장 많이 모여 있는 요소를 본문으로 추정
    const score = new Map();
    document.querySelectorAll("p").forEach((p) => {
      const len = txt(p).length;
      if (len < 40 || !p.parentElement) return;
      score.set(p.parentElement, (score.get(p.parentElement) || 0) + len);
    });
    let best = 0;
    score.forEach((v, k) => { if (v > best) { best = v; bodyEl = k; } });
  }

  const images = [];
  let body = "";
  let paragraphs = [];
  if (bodyEl) {
    // 이미지 + 캡션 수집
    bodyEl.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("data-src") || img.getAttribute("data-original") || img.currentSrc || img.src || "";
      if (!src || src.startsWith("data:")) return;
      const w = img.naturalWidth || img.width || 0;
      if (w && w < 120) return;
      let caption = "";
      const fig = img.closest("figure, .end_photo_org, .photo, .img_area, .article-photo, table, .image");
      if (fig) {
        const cap = fig.querySelector("figcaption, .img_desc, em.img_desc, .caption, .photo_caption, .txt_caption, .desc");
        caption = txt(cap);
      }
      if (!caption) {
        const next = img.parentElement && img.parentElement.nextElementSibling;
        if (next && /caption|desc|cap/i.test(next.className || "")) caption = txt(next);
      }
      if (!caption) caption = img.alt || "";
      try { images.push({ src: new URL(src, location.href).href, caption: caption.slice(0, 300) }); } catch (_) {}
    });

    const clone = bodyEl.cloneNode(true);
    clone.querySelectorAll(
      "script, style, noscript, iframe, figure, figcaption, .img_desc, .end_photo_org, .caption, " +
      "[class*='ad_'], [class*='advert'], [id*='ad_'], .reporter_area, .byline, .copyright, .relation, .related, button"
    ).forEach((n) => n.remove());
    // innerText는 화면에 붙지 않은 노드에서 줄바꿈을 잃으므로 블록 단위로 직접 나눈다
    const blocks = clone.querySelectorAll("p, div, li, h3, h4");
    const leafBlocks = Array.from(blocks).filter((b) => !b.querySelector("p, div, li"));
    paragraphs = leafBlocks.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => t.length > 15);
    if (paragraphs.length < 2) {
      paragraphs = (clone.innerHTML || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .split(/\n+/)
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 15);
    }
    body = paragraphs.join("\n");
  }
  if (!images.length) {
    const og = meta("og:image");
    if (og) images.push({ src: og, caption: "" });
  }

  // ---------- 기자 ----------
  const reporters = [];
  const addName = (n) => {
    n = (n || "").trim();
    if (/^[가-힣]{2,4}$/.test(n) && !reporters.includes(n) && !/^(뉴스|기자|사진|영상|온라인|디지털|편집|취재)$/.test(n)) reporters.push(n);
  };
  const reporterRe = /([가-힣]{2,4})\s?(?:선임|수석|전문|객원)?\s?(?:기자|특파원|논설위원|에디터)/g;
  const bylineSelectors = [
    ".media_end_head_journalist_name", ".byline", ".byline_s", ".reporter", ".journalist", ".writer",
    "[class*='byline']", "[class*='reporter']", "[class*='journalist']", "[class*='writer']",
    "[rel='author']", "[itemprop='author']",
  ];
  for (const s of bylineSelectors) {
    document.querySelectorAll(s).forEach((el) => {
      const t = txt(el);
      let m; reporterRe.lastIndex = 0;
      while ((m = reporterRe.exec(t))) addName(m[1]);
      if (!reporters.length && /^[가-힣]{2,4}$/.test(t)) addName(t);
    });
    if (reporters.length) break;
  }
  if (!reporters.length) {
    const metaAuthor = meta("author", "article:author", "dable:author", "byl") || [articleData.author].flat().map(a => typeof a === 'string' ? a : a?.name || '').join(', ');
    let m; reporterRe.lastIndex = 0;
    while ((m = reporterRe.exec(metaAuthor))) addName(m[1]);
    if (!reporters.length) addName(metaAuthor.replace(/기자.*$/, ""));
  }
  if (!reporters.length && body) {
    // 본문 첫 줄·마지막 부분의 "홍길동 기자"
    const zone = body.slice(0, 200) + "\n" + body.slice(-400);
    let m; reporterRe.lastIndex = 0;
    while ((m = reporterRe.exec(zone))) addName(m[1]);
  }
  const emailMatch = (document.body ? txt(document.body) : "").match(/[\w.+-]+@[\w-]+\.[\w.]+/);

  // ---------- 날짜 ----------
  let published = meta("article:published_time", "og:regDate", "datePublished", "pubdate", "date");
  let modified = meta("article:modified_time", "dateModified");
  const naverDate = document.querySelector("._ARTICLE_DATE_TIME, .media_end_head_info_datestamp_time");
  if (!published && naverDate) published = naverDate.getAttribute("data-date-time") || txt(naverDate);
  const naverModified = document.querySelector('._ARTICLE_MODIFY_DATE_TIME, [data-modify-date-time]');
  if (!modified && naverModified) modified = naverModified.getAttribute('data-modify-date-time') || naverModified.getAttribute('data-date-time') || txt(naverModified);
  if (!published && typeof articleData.datePublished === 'string') published = articleData.datePublished;
  if (!modified && typeof articleData.dateModified === 'string') modified = articleData.dateModified;
  // A date mentioned in the article body is not necessarily the publication date.

  const pageText = body.slice(0,12000).replace(/\s+/g,' ').trim();
  const links = [];
  const seenLinks = new Set();
  bodyEl?.querySelectorAll('a[href]').forEach(anchor => {
    try {
      const url = new URL(anchor.getAttribute('href'),location.href);
      const label = txt(anchor).replace(/\s+/g,' ').trim();
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !label || label.length>500 || !pageText.includes(label) || seenLinks.has(url.href)) return;
      seenLinks.add(url.href);
      links.push({url:url.href,text:label,article_quote:label});
    } catch (_) {}
  });
  const quotations = [...pageText.matchAll(/[“\"]([^”\"]{2,1000})[”\"]/g)].map(match => match[1]).slice(0,30);
  const eventData = [articleData.about].flat().find(item => item && [item['@type']].flat().includes('Event')) || {};
  const eventTime = typeof eventData.startDate === 'string' && pageText.includes(eventData.startDate) ? eventData.startDate : null;
  const place = typeof eventData.location === 'string' ? eventData.location : eventData.location?.name;
  const eventLocation = typeof place === 'string' && pageText.includes(place) ? place : null;

  // ---------- 원문 링크 (네이버 뉴스 등) ----------
  const origin = document.querySelector("a.media_end_head_origin_link, a[class*='origin']");

  return {
    url: location.href,
    host,
    originalUrl: origin ? origin.href : "",
    title,
    subtitle: txt(document.querySelector(".media_end_summary, .subtitle, .sub_title, .article_summary, h2.sub")).slice(0, 300),
    press,
    reporters,
    reporterEmail: emailMatch ? emailMatch[0] : "",
    published,
    modified,
    event_time: eventTime,
    event_location: eventLocation,
    article_context: {cited_links:links.slice(0,30),quotations,body_truncated:body.length>12000},
    body: body.slice(0, 12000),
    paragraphs: paragraphs.slice(0, 80),
    images: images.slice(0, 8),
    isArticle: body.length > 150 && title.length > 5,
  };
}

// 본문의 자극 키워드를 형광펜으로 표시하거나 지운다
export function highlightKeywords(words, on) {
  const CLASS = "__newscheck_mark";
  document.querySelectorAll("mark." + CLASS).forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  document.body.normalize();
  if (!on || !words || !words.length) return 0;

  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp("(" + esc.join("|") + ")", "g");
  const testRe = new RegExp(esc.join("|"));
  const roots = document.querySelectorAll(
    "h1, h2.media_end_head_headline, #title_area, #dic_area, #newsct_article, #articleBody, #article_body, " +
    "#article-view-content-div, [itemprop='articleBody'], .article_body, .article-body, .art_body, .news_body, article"
  );
  let count = 0;
  const seen = new Set();
  roots.forEach((root) => {
    if ([...seen].some((s) => s.contains(root))) return;
    seen.add(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && !/SCRIPT|STYLE|MARK|TEXTAREA/.test(n.parentElement.tagName) && testRe.test(n.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(re).forEach((part, i) => {
        if (i % 2 === 1) {
          const m = document.createElement("mark");
          m.className = CLASS;
          m.textContent = part;
          m.style.cssText = "background:#ffd8a8;color:#7a2e00;border-radius:3px;padding:0 2px;box-shadow:inset 0 -2px 0 #f08c00;";
          frag.appendChild(m);
          count++;
        } else if (part) frag.appendChild(document.createTextNode(part));
      });
      node.replaceWith(frag);
    });
  });
  const first = document.querySelector("mark." + CLASS);
  if (first && first.scrollIntoView) first.scrollIntoView({ behavior: "smooth", block: "center" });
  return count;
}

// 주장이 나온 본문 문장으로 스크롤하고 잠깐 강조한다
export function findQuote(quote) {
  const q = (quote || "").replace(/\s+/g, " ").trim();
  if (!q) return false;
  const tries = [q, q.slice(0, 30), q.slice(0, 15)];
  for (const t of tries) {
    window.getSelection().removeAllRanges();
    if (t.length >= 6 && window.find(t, false, false, true)) {
      const sel = window.getSelection();
      const el = sel.anchorNode && sel.anchorNode.parentElement;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const prev = el.style.backgroundColor;
        el.style.transition = "background-color .6s";
        el.style.backgroundColor = "#e4e0ff";
        setTimeout(() => (el.style.backgroundColor = prev), 2200);
      }
      return true;
    }
  }
  return false;
}

// 기사 제목 옆에 "근거 확인 현황" 배지를 붙인다. (사실·거짓 판정이 아니라 출처 확인 상태 표시)
// 기사 페이지 안에서 실행되므로 바깥 변수를 쓰지 않는 독립 함수여야 한다.
export function markHeadline(title, info) {
  const ID = 'newscheck-badge-host';
  document.getElementById(ID)?.remove();
  const norm = (value) => String(value || '').replace(/[^0-9A-Za-z가-힣]/g, '');
  const ref = norm(title);
  if (ref.length < 4 || !info) return false;
  const near = (value) => {
    const n = norm(value);
    if (n.length < 4 || n.length > ref.length * 3) return false;
    const grams = [];
    for (let i = 0; i < n.length - 1; i++) grams.push(n.slice(i, i + 2));
    return grams.length > 0 && grams.filter((g) => ref.includes(g)).length / grams.length >= 0.6;
  };
  const heading = [...document.querySelectorAll('h1, h2, h3, [itemprop="headline"], #title_area, .media_end_head_headline')]
    .find((el) => near(el.innerText || el.textContent));
  if (!heading) return false;

  const host = document.createElement('span');
  host.id = ID;
  host.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:10px;position:relative;font-size:0;line-height:1;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif}',
    '.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #5b4cf0;background:#eeecfe;color:#3b2fb8;border-radius:999px;padding:4px 10px;font-size:12px;line-height:1.2;font-weight:700;cursor:pointer}',
    '.chip.lvl-clear{border-color:#1f9d55;background:#e6f6ec;color:#146c3a}',
    '.chip.lvl-caution{border-color:#d49a00;background:#fff6d6;color:#7a5800}',
    '.chip.lvl-unknown{border-color:#8a8aa0;background:#f0f0f5;color:#4a4a5c}',
    '.chip.lvl-review{border-color:#d64545;background:#fde8e8;color:#9b1c1c}',
    '.chip .warn{color:#b25e00;background:#fff1dc;border-radius:999px;padding:1px 7px;font-weight:700}',
    '.pop{position:absolute;left:0;top:calc(100% + 8px);z-index:2147483647;width:300px;max-width:80vw;background:#fff;color:#1b1b28;border:1px solid #e7e7f0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px 14px;font-size:13px;line-height:1.55;text-align:left;font-weight:400}',
    '.pop[hidden]{display:none}',
    '.pop h4{margin:0 0 6px;font-size:12px;color:#3b2fb8}',
    '.pop p{margin:0 0 6px}',
    '.pop .head{font-weight:700;font-size:14px}',
    '.pop ul{margin:0 0 6px;padding-left:18px;color:#5d5d72}',
    '.pop .note{font-size:12px;color:#5d5d72;margin:6px 0 0}',
  ].join('');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (/^(clear|caution|unknown|review)$/.test(String(info.level)) ? ' lvl-' + info.level : '');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-label', '뉴스체크 출처 확인·주의 상태');
  const label = document.createElement('span');
  label.textContent = String(info.label || '근거 확인 현황');
  chip.appendChild(label);
  if (info.caution) {
    const warn = document.createElement('span');
    warn.className = 'warn';
    warn.textContent = String(info.caution);
    chip.appendChild(warn);
  }
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.hidden = true;
  const add = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = String(text); pop.appendChild(el); return el; };
  add('h4', '', '뉴스체크 · 출처 확인·주의 상태');
  add('p', 'head', info.headline || '');
  if (Array.isArray(info.lines) && info.lines.length) {
    const ul = document.createElement('ul');
    info.lines.forEach((line) => { const li = document.createElement('li'); li.textContent = String(line); ul.appendChild(li); });
    pop.appendChild(ul);
  }
  if (info.partial) add('p', '', '일부 단계를 처리하지 못해 결과가 불완전해요.');
  add('p', 'note', info.note || '');
  const close = () => { pop.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
  chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    pop.hidden = !pop.hidden;
    chip.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (event) => { if (!host.isConnected) return; if (!event.composedPath().includes(host)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  root.appendChild(style);
  root.appendChild(chip);
  root.appendChild(pop);
  heading.appendChild(host);
  return true;
}
