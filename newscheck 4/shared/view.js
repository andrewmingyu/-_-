import { sourceNotice, NOTICE_NOTE, reportReviewPoints } from './summary.js';

export const SOURCE_LABELS = { original_found: '원본 자료 확인', secondary_only: '재인용 자료만 확인', source_not_found: '원출처를 찾지 못함', unknown: '확인에 필요한 정보 부족' };
export const CAUTION_LABELS = { caution: '주의사항 표시 필요', none_identified: '현재 별도 주의사항을 발견하지 못함', unknown: '출처 분석 정보 부족' };
export const TYPE_LABELS = { factual_narration: '사실 서술', quotation: '발언·인용', opinion: '의견', interpretation: '해석', prediction: '예측', context: '배경·맥락', statistics: '통계·연구', unknown: '유형 미확인' };
const FACT_LABELS = { identity: '작성기관', authorship:'작성자', originality: '원자료·재인용 관계', expertise: '전문성', information_access: '정보 접근 경로', date_context: '작성 시점', public_access: '공개·검증 가능성', methodology: '조사 방법', interests: '이해관계', independence: '독립 자료 여부' };
const KIND_LABELS={official_release:'공식 발표·보도자료',public_record:'정부·공공기관 자료',research:'연구·논문',statistics:'통계',interview:'인터뷰',expert_comment:'전문가 발언',news_report:'언론 보도',anonymous_statement:'익명 관계자 발언',unknown:'종류 미확인'};
const kindLabel=value=>KIND_LABELS[value] || value;
const REPORT_ASPECTS={topic:'보도 주제',event:'사건 설명',actors:'등장 인물·기관',time:'시점·일정',figures:'수치·범위',attribution:'인용·발언',focus:'강조점',context:'배경·맥락'};
const REPORT_BASES={body_excerpt:'확보한 본문 발췌 비교',search_snippet:'검색 요약 범위 비교',title_only:'제목만 비교',unknown:'비교 범위 미확인'};
export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeLink(url, label, demo = false) {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return esc(label);
    if (demo) return esc(label) + ' (시연용 링크)';
    return '<a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>';
  } catch { return esc(label); }
}
const list = items => items.length ? '<ul>' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="muted">확인된 정보 없음</p>';
const pill = (label, caution = false) => '<span class="trace-badge' + (caution ? ' caution' : '') + '">' + esc(label) + '</span>';
const errorList = errors => errors?.length ? '<div role="status">' + list(errors.map(e=>e.message+(e.retry_after_seconds!=null?' ('+e.retry_after_seconds+'초 후 다시 시도)':''))) + '</div>' : '';
function decisionDetails(decision,sources,demo) {
  if(!decision.details?.length)return list(decision.reasons);
  return '<ul>'+decision.details.map(d=>'<li>'+esc(d.reason)+d.source_ids.map(id=>sources.find(s=>s.id===id)).filter(Boolean).map(s=>' · '+safeLink(s.url,s.title,demo)).join('')+'</li>').join('')+'</ul>';
}
export function sourceSummary(s, demo = false) {
  return '<div class="source-row">' + pill(SOURCE_LABELS[s.original_status]) + '<strong>' + safeLink(s.url, s.title, demo) + '</strong><p>' + esc(s.discovery === 'article_cited' ? '기사에 언급된 출처' : '외부 검색에서 추가 발견 · 기사 인용으로 확인되지 않음') + '</p><p>' + esc(s.summary) + '</p>'+(['snippet_only','unavailable'].includes(s.content_status)?'<p class="trace-note">검색 요약만 확보 · 원문은 확인하지 못했습니다.</p>':'')+'</div>';
}
function sourceDetails(s, demo) {
  // 확인된 속성만 표로 보여주고, 확인하지 못한 항목은 한 줄로 묶는다 (관찰 사실과 미확인 속성 구분 유지)
  const known=[], unknown=[];
  [['발행기관',s.publisher],['발행일',s.published_at],['자료 종류',s.source_kind && s.source_kind!=='unknown'?kindLabel(s.source_kind):null]].forEach(([label,value])=>(value?known.push([label,value]):unknown.push(label)));
  Object.entries(FACT_LABELS).forEach(([k,label])=>(s.facts[k]?.excerpt?known.push([label,s.facts[k].excerpt]):unknown.push(label)));
  const reasons=[...new Set((s.caution?.reasons||[]).filter(Boolean))];
  return sourceSummary(s, demo) +
    (known.length?'<dl>'+known.map(([label,value])=>'<dt>'+label+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl><p class="trace-note">출처 원문에 기재된 문구이며 주장의 진위를 보증하지 않습니다.</p>':'') +
    (unknown.length?'<p class="muted">확인하지 못한 항목: '+esc(unknown.join(', '))+'</p>':'') +
    (reasons.length?'<p class="muted">출처 분석 이유: '+esc(reasons.join(' '))+'</p>':'');
}
// 기사가 직접 언급한 자료만 (외부 검색으로 추가 발견한 자료는 근거·주의 화면에서 제외)
// 외국어 기사: 요약 자리에는 한국어 번역을, 상세에는 원문 + 번역을 함께 보여준다
const translated = (item, fallback) => item?.translation || fallback;
const translationLine = item => item?.translation ? '<p class="translation"><span class="trace-badge">AI 번역</span> ' + esc(item.translation) + '</p>' : '';
// 날짜 표기 통일: 'YYYY년 M월 D일' + 필요하면 괄호 꼬리표 (현지시간)/(보도일).
// 원문에 없는 연·월은 채우지 않는다 (예: '9일'은 '9일'로 둔다. 기사 작성일이 틀린 사이트가 있어 추정하지 않음)
const EN_MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const monthNum = w => EN_MONTHS[String(w).slice(0,3).toLowerCase()];
const ymd = (y, m, d) => [y && Number(y) + '년', m && Number(m) + '월', d && Number(d) + '일'].filter(Boolean).join(' ');
export function formatEventDate(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  let tag = '';
  s = s.replace(/[(（]?\s*(현지|한국)\s*시[각간]\s*(기준)?\s*[)）]?/g, (_, where) => { tag = '(' + where + '시간)'; return ' '; }).trim();
  let prefix = '';
  s = s.replace(/^(지난|오는|올해|작년|지난해|내년)\s*/, (_, w) => { prefix = w + ' '; return ''; });
  let core = null, m;
  if ((m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/))) core = ymd(m[1], m[2], m[3]);
  else if ((m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\.?$/))) core = ymd(m[1], m[2]);
  else if ((m = s.match(/^(?:(\d{4})\s*년)?\s*(?:(\d{1,2})\s*월)?\s*(?:(\d{1,2})\s*일)?\s*(초|중순|말|께|쯤|경)?$/)) && (m[1] || m[2] || m[3])) core = ymd(m[1], m[2], m[3]) + (m[4] ? ' ' + m[4] : '');
  else if ((m = s.match(/^(\d{4})$/))) core = m[1] + '년';
  else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)) && monthNum(m[1])) core = ymd(m[3], monthNum(m[1]), m[2]);
  else if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?$/)) && monthNum(m[2])) core = ymd(m[3], monthNum(m[2]), m[1]);
  else if ((m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)) && monthNum(m[1])) core = ymd(m[2], monthNum(m[1]));
  return (prefix + (core ?? s)).trim() + (tag ? ' ' + tag : '');
}
// 원문 문장에 적힌 날짜가 있으면 그 날짜를, 없으면 그 내용이 보도된 시점(기사 작성일)을 '(보도일)'로 구분해 표시
const knownDate = d => d && d !== '시점 미확인' ? d : '';
function dateTag(a, d) {
  if (knownDate(d)) return {text:formatEventDate(d), report:false};
  const published = String(a.article?.published_at || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return published ? {text:ymd(published[1], published[2], published[3]) + ' (보도일)', report:true} : null;
}
// 상자가 좁아도 '2018년 3월 9일' / '(보도일)' 단위로만 줄바꿈되게 나눠 담는다
const dateParts = text => esc(text).split(/ (?=\()/).map(part => '<span class="date-part">' + part + '</span>').join(' ');
const dateSpan = tag => tag ? '<span class="context-date' + (tag.report ? ' context-date-report" title="문장에 날짜가 없어 기사 작성일(보도 시점)을 표시했어요' : '') + '">' + dateParts(tag.text) + '</span>' : '';
function citedSources(a) { return (a.sources || []).filter(s => s.discovery === 'article_cited'); }
// 근거마다 어떤 주장의 근거인지 표시 (주장 번호는 기사의 주장 카드 순서)
function claimTags(a, ids) {
  const nums = (a.claims || []).flatMap((c, i) => (ids || []).includes(c.id) ? [i + 1] : []);
  return nums.length ? nums.map(n => '<span class="trace-badge claim-no">주장 ' + n + '의 근거</span>').join('') : '<span class="trace-badge">연결된 주장 없음</span>';
}
function reportComparison(report,detailed) {
  const points=report.comparison_points || [];
  const reviews=new Set(reportReviewPoints(report));
  const basis=pill(REPORT_BASES[report.comparison_basis] || REPORT_BASES.unknown);
  if(report.comparison_status!=='compared' || !points.length){
    const message=report.comparison_status==='failed'?'보도 비교를 완료하지 못했습니다. 원문을 직접 확인해 주세요.':report.comparison_status==='insufficient'?'확보한 범위에서 비교할 구절을 확인하지 못했습니다.':'아직 다른 보도와 비교하지 않은 결과입니다.';
    return '<div class="report-comparison">'+basis+'<p class="muted">'+esc(message)+'</p></div>';
  }
  if(!detailed){
    return '<div class="report-comparison">'+basis+['common','difference'].map(kind=>{
      const aspects=[...new Set(points.filter(p=>p.kind===kind).map(p=>REPORT_ASPECTS[p.aspect]))];
      return aspects.length?'<p><b>'+(kind==='common'?'공통으로 다룬 항목':'표현·강조 차이')+'</b> · '+esc(aspects.join(', '))+'</p>':'';
    }).join('')+'</div>';
  }
  return '<div class="report-comparison">'+basis+points.map(point=>
    '<div class="comparison-point'+(reviews.has(point)?point.review_status==='paired_excerpt'?' report-review':' report-candidate':'')+'"><h3>'+esc(reviews.has(point)?point.review_status==='paired_excerpt'?'🔴 교차검증 필요':'🟡 원문 확인 필요':point.kind==='common'?'공통으로 다룬 내용':'표현·강조가 다른 부분')+' · '+esc(REPORT_ASPECTS[point.aspect])+'</h3>'+
    (reviews.has(point)?'<p>'+esc(point.review_kind==='citation_difference'?'인용 원문과 조건·표현에 차이가 있어 왜곡 여부를 확인해야 합니다.':'같은 사안에 대한 서술이 충돌할 가능성이 있어 두 보도의 맥락을 확인해야 합니다.')+'</p>'+(point.context_anchor?'<p class="trace-note">비교 기준: '+esc(point.context_anchor)+'</p>':'')+'<p class="trace-note">AI가 찾은 재확인 후보입니다. 어느 기사가 사실인지 판정한 결과가 아닙니다.</p>':'')+
    '<div class="report-pair"><div><b>현재 기사</b><blockquote>'+esc(point.article_quote)+'</blockquote><button class="link-btn" data-quote="'+esc(point.article_quote)+'">본문에서 보기</button></div><div><b>'+(report.original_candidate?'원문 후보':'비교 보도')+'</b><blockquote>'+esc(point.related_quote)+'</blockquote>'+(point.related_quote_ko?'<b>AI 한국어 번역</b><blockquote>'+esc(point.related_quote_ko)+'</blockquote>':'')+'</div></div>'+(point.explanation?'<p class="odiff-why"><b>무엇이 달라졌나요?</b> '+esc(point.explanation)+'</p>':'')+'</div>'
  ).join('')+'</div>';
}
function summaryLines(value) {
  const text=String(value || '').trim();
  const lines=text.split(/\n+/).map(line=>line.replace(/^\s*[-•]\s+/, '').trim()).filter(Boolean);
  if(lines.length>1)return lines.slice(0,2);
  if(typeof Intl.Segmenter==='function')return [...new Intl.Segmenter('ko',{granularity:'sentence'}).segment(text)].map(item=>item.segment.trim()).filter(Boolean).slice(0,2);
  return text.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,2);
}
function compactDate(value) {
  return value?String(value).replace('T',' ').replace(/^(\d{4})-(\d{2})-(\d{2})/,'$1.$2.$3').slice(0,16):'미확인';
}
export function reasonPhrase(value) {
  return String(value || '').trim().replace(/[.!?。]+$/,'')
    .replace(/밝혔(?:다|습니다)$/,'밝힘')
    .replace(/말했(?:다|습니다)$/,'언급')
    .replace(/전했(?:다|습니다)$/,'전달')
    .replace(/알렸(?:다|습니다)$/,'알림')
    .replace(/(?:하지 못했다|하지 못했습니다)$/,'하지 못함')
    .replace(/하지 못합니다$/,'하지 못함')
    .replace(/(?:않았다|않았습니다)$/,'않음')
    .replace(/않는다$/,'않음')
    .replace(/(?:중이다|중입니다)$/,'중')
    .replace(/(?:예정이다|예정입니다)$/,'예정')
    .replace(/(?:아니다|아닙니다)$/,'아님')
    .replace(/(?:없다|없습니다)$/,'없음')
    .replace(/(?:있다|있습니다)$/,'있음')
    .replace(/(?:되었다|됐다|됐습니다)$/,'됨')
    .replace(/(?:하였다|했다|했습니다|합니다|한다)$/,'').trim();
}
function contextFlow(a) {
  const nodes=a.context_timeline.length?a.context_timeline.slice(0,4):a.event?.description?[{
    date:a.event.time || a.article.event_time || '시점 미확인',label:a.event.label || '주요 사건',is_main_event:true,description:a.event.description,article_quote:a.event.article_quote || a.event.description,
  }]:[];
  if(!nodes.length)return '<p class="muted">기사에서 확인할 수 있는 배경 정보가 없습니다.</p>';
  return '<div class="context-flow" role="list" aria-label="기사에서 확인한 흐름" tabindex="0">'+nodes.map((node,index)=>
    (index?'<span class="context-arrow" aria-hidden="true">→</span>':'')+'<div class="context-step'+(node.is_main_event?' context-main':'')+'" role="listitem"'+(node.is_main_event?' aria-label="주요 사건"':'')+'>'+dateSpan(dateTag(a,node.date))+(node.is_main_event?'<span class="context-main-label">주요 사건</span>':'')+'<p title="'+esc(node.description)+'">'+esc(node.label || (node.is_main_event?'주요 사건':'배경 정보'))+'</p></div>'
  ).join('')+'</div>';
}
function headlineCard(a,expanded) {
  const h=a.headline_explanation, reasons=h?.reasons || [];
  const available=Boolean(h?.meaning && reasons.length);
  const message=a.ui_state==='loading'?'기사 본문에서 제목의 의미와 이유를 읽는 중입니다.':a.ui_state==='error'?'제목 설명을 불러오지 못했습니다. 다시 분석해 주세요.':'제목 설명이 아직 없습니다. 다시 분석해 주세요.';
  const open=expanded.has('headline');
  return '<section class="card headline-explanation" aria-labelledby="headline-explanation-title"><div class="headline-heading"><h2 id="headline-explanation-title">제목의 의미</h2>'+(a.is_demo?'<span class="trace-badge">시연용</span>':'')+
    (available?'<button class="btn" data-headline-toggle aria-label="제목의 의미와 뒷받침하는 내용 '+(open?'접기':'자세히 보기')+'" aria-expanded="'+open+'" aria-controls="headline-details">'+(open?'접기 ∧':'자세히 보기 ›')+'</button>':'')+'</div>'+
    // 접힌 상태: 짧게 정리한 내용만 / 펼친 상태: 같은 번호 아래에 기사 원문을 들여쓰기로 붙인다 (주장과 근거 카드와 같은 형식)
    (available?'<p class="headline-meaning">'+esc(h.meaning)+'</p><h3 class="headline-reasons-title">제목을 뒷받침하는 내용</h3>'+
    '<ol class="headline-reasons" id="headline-summary"'+(open?' hidden':'')+'>'+reasons.map(r=>'<li>'+esc(reasonPhrase(r.text))+'</li>').join('')+'</ol>'+
    '<ol class="headline-reasons headline-reasons-detail" id="headline-details"'+(open?'':' hidden')+'>'+reasons.map((r,i)=>'<li>'+esc(reasonPhrase(r.text))+
      '<div class="evidence-list headline-quote"><blockquote>'+esc(r.article_quote)+'</blockquote><button class="link-btn" data-quote="'+esc(r.article_quote)+'">본문에서 보기</button> · <button class="link-btn" data-headline-jump="'+i+'">주장과 근거에서 보기 →</button></div></li>').join('')+'</ol>':'<p class="muted">'+esc(message)+'</p>')+'</section>';
}
function relatedList(items,demo,detailed=false) {
  if(!items.length)return '<p class="muted">관련 기사 없음</p>';
  const row=(report,link)=>'<span class="related-press" title="'+esc(report.publisher || '언론사 미확인')+'">'+esc(report.publisher || '언론사 미확인')+'</span><span class="related-title" title="'+esc(report.title)+'">'+(link?safeLink(report.url,report.title,demo):esc(report.title))+'</span><span class="related-date" title="'+esc(report.published_at || '작성일 미확인')+'">'+esc(report.published_at?compactDate(report.published_at).slice(0,10):'날짜 미확인')+'</span>';
  if(!detailed)return '<ul class="related-list">'+items.map(report=>'<li class="related-row">'+row(report,true)+'</li>').join('')+'</ul>';
  return '<div class="related-details">'+items.map(report=>'<details class="report-detail"'+(report.id?' id="related-report-'+esc(report.id)+'"':'')+'><summary class="related-row">'+row(report,false)+'<span class="report-open" aria-hidden="true">⌄</span></summary><div class="report-body"><p>'+safeLink(report.url,'원문 기사 열기',demo)+'</p>'+reportComparison(report,true)+'<p class="muted">'+esc(report.independence)+'</p></div></details>').join('')+'</div><p class="trace-note">공통 보도는 사실 확인을 뜻하지 않으며 표현 차이만으로 어느 쪽이 맞는지 판단하지 않습니다.</p>';
}
export function sectionData(a) {
  const article = a.article;
  const metadata = '<dl>' + [['언론사',article.publisher],['기자',article.author],['작성일',article.published_at?compactDate(article.published_at):null]].map(([k,v]) => '<dt>' + k + '</dt><dd>' + esc(v || '미확인') + '</dd>').join('') + '</dl>';
  const timeline = contextFlow(a);
  const event=a.event?.description?'<details class="event-original"><summary>핵심 사건 원문</summary><blockquote>'+esc(a.event.article_quote || a.event.description)+'</blockquote></details>':'';
  const timelineDetails = a.context_timeline.map(t=>'<div class="source-row"><p>'+esc((dateTag(a,t.date)?dateTag(a,t.date).text+' → ':'')+t.description)+'</p><button class="link-btn" data-quote="'+esc(t.article_quote)+'">본문에서 보기</button>'+(t.source_ids||[]).map(id=>a.sources.find(s=>s.id===id)).filter(Boolean).map(s=>'<p>'+safeLink(s.url,s.title,a.is_demo)+'</p>').join('')+'</div>').join('');
  const cited = citedSources(a);
  const norm = t => String(t || '').replace(/\s+/g,' ').trim();
  // 근거로 뽑은 문장이 주장 원문과 겹치면 그 주장 번호를 돌려준다 (같은 문장을 두 번 보여주지 않기 위해)
  const sameClaimNo = m => {
    const q = norm(m.article_quote);
    const i = a.claims.findIndex(c => { const o = norm(c.original_text); return q && o && (q.includes(o) || o.includes(q)); });
    return i < 0 ? 0 : i + 1;
  };
  // 출처 이름: 근거의 출처 표기 → 없으면 연결된 주장의 발언자
  const sourceName = m => m.source_label || a.claims.filter(c => m.claim_ids.includes(c.id) && c.speaker).map(c => c.speaker)[0] || '';
  // 주장 아래에 들어가는 근거 한 개. 같은 근거가 여러 주장에 연결되면 이동용 id는 처음 한 번만 붙인다.
  const placed = new Set();
  const evidenceItem = m => {
    const sources = cited.filter(s => s.mention_ids.includes(m.id));
    const same = sameClaimNo(m), name = sourceName(m);
    const anchor = placed.has(m.id) ? '' : ' id="evidence-mention-'+esc(m.id)+'"';
    placed.add(m.id);
    const kind = m.source_kind && m.source_kind !== 'unknown' ? ' <span class="ev-tag">' + esc(kindLabel(m.source_kind)) + '</span>' : '';
    const named = name && norm(m.article_quote).includes(norm(name));
    const body = same
      ? '<p><strong>' + esc(name ? '출처: ' + name : '출처를 밝히지 않은 문장') + '</strong></p><p class="muted">주장 문장 안에 출처가 함께 적혀 있어요.</p>'
      : '<blockquote>' + esc(m.article_quote) + kind + '</blockquote>' + translationLine(m) + (named ? '' : '<p>출처: ' + esc(name || '명시되지 않음') + '</p>');
    // 주장과 같은 문장이면 '본문에서 보기'는 위 주장에 이미 있으므로 다시 넣지 않는다
    return '<li class="evidence-item"'+anchor+'>' + body + (same ? '' : '<button class="link-btn" data-quote="' + esc(m.article_quote) + '">본문에서 보기</button>') +
      sources.map(s => '<div id="evidence-source-'+esc(s.id)+'">'+sourceDetails(s,a.is_demo)+'</div>').join('') + '</li>';
  };
  const claimEvidence = c => a.evidence_mentions.filter(m => m.claim_ids.includes(c.id));
  // 접힌 상태: 주장만 번호로 나열하고 근거 개수만 표시
  const claimSummary = a.claims.length ? '<ol class="claim-list">' + a.claims.map((c,i) => {
    const n = claimEvidence(c).length;
    return '<li><span class="trace-badge claim-no">주장 ' + (i+1) + '</span>' + esc(translated(c, c.claim_text)) + (n ? ' <span class="evidence-count">근거 ' + n + '</span>' : '') + '</li>';
  }).join('') + '</ol>' : '<p class="muted">원문과 연결된 주장을 추출하지 못했습니다.</p>';
  // 펼친 상태: 주장 1 → 근거들, 주장 2 → 근거들
  const claimDetails = a.claims.map((c,i) => {
    const items = claimEvidence(c);
    // 근거가 따로 없어도 발언자 이름이 주장 문장 안에 실제로 있으면 그 발언자를 근거(출처)로 보여 준다 (AI가 짐작한 이름은 쓰지 않음)
    const speakerInText = c.speaker && norm(c.original_text).includes(norm(c.speaker));
    const speakerItem = !items.length && speakerInText ? '<li class="evidence-item"><p><strong>출처: ' + esc(c.speaker) + '</strong></p><p class="muted">주장 문장 안에 출처가 함께 적혀 있어요.</p></li>' : '';
    // 근거에 같은 이름이 나오면 '발언자:' 줄은 생략해 같은 이름을 두 번 보여 주지 않는다
    const shownInEvidence = speakerItem || (c.speaker && items.some(m => norm(sourceName(m)) === norm(c.speaker)));
    const list = items.length ? items.map(evidenceItem).join('') : speakerItem;
    return '<li class="claim-block"><div class="claim-head"><span class="trace-badge claim-no">주장 ' + (i+1) + '</span>' + pill(TYPE_LABELS[c.claim_type]) + pill(SOURCE_LABELS[c.source_status]) + '</div>' +
      '<blockquote>' + esc(c.original_text) + '</blockquote>' + translationLine(c) + (shownInEvidence ? '' : '<p>발언자: ' + esc(c.speaker || '미확인') + '</p>') + '<button class="link-btn" data-quote="' + esc(c.original_text) + '">본문에서 보기</button>' +
      '<h3 class="evidence-heading">근거</h3>' + (list ? '<ol class="evidence-list">' + list + '</ol>' : '<p class="muted">기사에 이 주장의 근거가 따로 제시되지 않았어요.</p>') + '</li>';
  }).join('');
  const looseMentions = a.evidence_mentions.filter(m => !a.claims.some(c => m.claim_ids.includes(c.id)));
  const linked = new Set(a.evidence_mentions.flatMap(m => cited.filter(s => s.mention_ids.includes(m.id)).map(s => s.id)));
  const otherCited = cited.filter(s => !linked.has(s.id));
  // Prefer articles from different publishers. Unknown publisher uses hostname.
  const seen = new Set();
  const related = a.related_articles.filter(r => { let key; try { key = r.publisher || new URL(r.url).hostname; } catch { return false; } if (seen.has(key)) return false; seen.add(key); return true; });
  const compactMetadata='<dl class="compact-meta">'+[['언론사',article.publisher],['기자',article.author],['작성일',compactDate(article.published_at)]].map(([label,value])=>'<div><dt>'+label+'</dt><dd title="'+esc(value || '미확인')+'">'+esc(value || '미확인')+'</dd></div>').join('')+'</dl>';
  return [
    {id:'context',title:'배경 및 맥락',summary:timeline,details:timeline+event+timelineDetails + '<p class="trace-note">기사에서 확인한 흐름이며 화살표가 인과관계를 입증하는 것은 아닙니다.</p>'},
    {id:'metadata',title:'기사 기본 정보',summary:compactMetadata,details:metadata + '<dl><dt>수정일</dt><dd>' + esc(article.updated_at?compactDate(article.updated_at):'미확인') + '</dd><dt>원문</dt><dd>' + safeLink(article.url,'기사 원문',a.is_demo) + '</dd><dt>기자 정보</dt><dd>' + (article.author_profile_url ? safeLink(article.author_profile_url,'공개 프로필',a.is_demo) : '확인 가능한 공개 프로필 없음') + '</dd></dl>'},
    {id:'claims',title:'기사의 주장과 근거',more:'근거 보기',summary:claimSummary,details:(a.claims.length ? '<ol class="claim-details">' + claimDetails + '</ol>' : '<p class="muted">원문과 연결된 주장을 추출하지 못했습니다.</p>') +
      (looseMentions.length ? '<h3>주장과 연결되지 않은 근거</h3><ol class="evidence-list">' + looseMentions.map(evidenceItem).join('') + '</ol>' : '') +
      (otherCited.length ? '<h3>기사에 언급된 기타 자료</h3>' + otherCited.map(s => '<div id="evidence-source-'+esc(s.id)+'">'+sourceDetails(s,a.is_demo)+'</div>').join('') : '') +
      '<p class="trace-note">기사 안에서 제시된 근거만 보여줍니다. 외부 검색으로 찾은 자료는 근거로 표시하지 않습니다.</p>'},
    {id:'related',title:'비슷한 주제의 기사',summary:relatedList(related.slice(0,5),a.is_demo),details:relatedList(related,a.is_demo,true)}
  ];
}
const moreLabel = s => (s.more || '자세히 보기') + ' ›';
// 주장 카드는 서버의 claims·evidence 상태 중 더 나쁜 쪽을 보여준다
const STATE_RANK = {error:4,partial:3,loading:2,empty:1,ready:0};
function sectionState(a,id) {
  const states=a.section_states || {};
  if(id!=='claims') return states[id];
  return [states.claims,states.evidence].filter(Boolean).sort((x,y)=>(STATE_RANK[y.status]??0)-(STATE_RANK[x.status]??0))[0];
}
function sectionMarkup(a,s,expanded) {
  const state=sectionState(a,s.id);
  // 준비됨·일부 미확인 같은 진행 상태는 표시하지 않고, 분석 중·처리 실패와 빈 카드 안내만 보여 준다
  const label=state&&s.id!=='metadata'?({error:'처리 실패',loading:'분석 중'})[state.status]:'';
  const text=label?label+(state.message?' · '+state.message:''):state?.status==='empty'&&s.id!=='metadata'?state.message:'';
  const status=text?'<p class="section-state" role="status">'+esc(text)+'</p>':'';
  return '<section class="card analysis-section'+(s.id==='metadata'?' compact-metadata':'')+'" data-section="'+s.id+'"><div class="section-heading"><h2>'+s.title+'</h2><button type="button" data-toggle="'+s.id+'" aria-label="'+s.title+' '+(expanded.has(s.id)?'접기':(s.more || '자세히 보기'))+'" aria-expanded="'+expanded.has(s.id)+'" aria-controls="details-'+s.id+'">'+(expanded.has(s.id)?'접기 ∧':moreLabel(s))+'</button></div>'+status+'<div id="summary-'+s.id+'"'+(expanded.has(s.id)?' hidden':'')+'>'+s.summary+'</div><div id="details-'+s.id+'"'+(!expanded.has(s.id)?' hidden':'')+'>'+s.details+'</div></section>';
}

function noticeStrip(a) {
  const notice=sourceNotice(a);
  if(!notice) return '';
  // 긴 제목은 단어 중간이 아니라 단어 경계에서 자른다
  const short=t=>{t=String(t || '');if(t.length<=50)return t;let cut=t.slice(0,50);if(!/\s/.test(t[50]))cut=cut.replace(/\s+\S*$/,'');return cut.trimEnd()+'…';};
  const row=item=>{
    // 원문 후보: 'BBC「제목…」↗' 한 줄 + 대조 버튼만 (같은 링크를 두 번 보여 주지 않음)
    const cand=item.candidate_id && a.related_articles.find(r=>r.id===item.candidate_id);
    if(cand){
      const claims=item.claim_ids.map(id=>'주장 '+(a.claims.findIndex(c=>c.id===id)+1)).map(esc);
      const refs=[...claims,'<button class="link-btn" data-report-review="'+esc(cand.id)+'">두 기사 대조 보기</button>'];
      return '<li class="notice-candidate">원문 후보: '+(cand.publisher?esc(cand.publisher):'')+'「'+safeLink(cand.url,short(cand.title),a.is_demo)+'」<p class="muted">관련: '+refs.join(' · ')+'</p></li>';
    }
    const claims=item.claim_ids.map(id=>'주장 '+(a.claims.findIndex(c=>c.id===id)+1));
    const sources=item.source_ids.map(id=>a.sources.find(s=>s.id===id)).filter(Boolean);
    const refs=[...claims.map(esc),...sources.map(s=>safeLink(s.url,s.title,a.is_demo))];
    refs.push(...(item.report_ids || []).map(id=>a.related_articles.find(r=>r.id===id)).filter(Boolean).map(r=>safeLink(r.url,'비교 보도 원문',a.is_demo)+' <button class="link-btn" data-report-review="'+esc(r.id)+'">두 기사 대조 보기</button>'));
    return '<li'+(item.severity==='review'?' class="review-text"':'')+'>'+esc(item.text)+(refs.length?'<p class="muted">관련: '+refs.join(' · ')+'</p>':'')+'</li>';
  };
  const rows=notice.issues.slice(0,3).map(row).join('');
  const extra=notice.issues.slice(3);
  return '<section class="card notice-card notice-'+notice.level+'" aria-label="출처 확인·주의 상태">'+
    '<h2>출처 확인·주의 상태</h2><p class="notice-level">'+notice.icon+' '+esc(notice.text)+'</p>'+
    (rows?'<ul class="notice-list">'+rows+'</ul>':'')+
    (extra.length?'<details class="notice-more"><summary>나머지 '+extra.length+'개 더 보기</summary><ul class="notice-list">'+extra.map(row).join('')+'</ul></details>':'')+
    '<p class="trace-note">'+esc(NOTICE_NOTE)+'</p></section>';
}

// 원본 확인 자료와 검색 후보를 명시적으로 구분하며 상단 비교 기능을 보존한다.
function originalDiffs(a) {
  const trim = u => String(u).replace(/\/$/, '');
  const originals = new Set((a.sources || []).filter(s => s.discovery === 'article_cited' && s.original_status === 'original_found').map(s => trim(s.url)));
  return (a.related_articles || []).filter(r => r.comparison_status === 'compared' && (r.original_candidate || originals.has(trim(r.url))))
    .map(r => ({ report: r, points: (r.comparison_points || []).filter(p => p.kind === 'difference') }))
    .filter(x => x.points.length);
}

function diffCard(a) {
  const groups = originalDiffs(a);
  if (!groups.length) return '';
  const total = groups.reduce((n, g) => n + g.points.length, 0);
  return '<section class="card odiff" aria-label="원문과 다른 점"><h2 class="odiff-title"><span aria-hidden="true">🚨</span> 원문과 다른 점 ' + total + '건</h2>' + groups.map(g =>
    '<p class="trace-headline">'+(g.report.original_candidate?'원문 후보 · 인용 관계 미확인: ':'기사 인용 원본 확인 자료: ') + safeLink(g.report.url, g.report.title, a.is_demo) + '</p>' +
    g.points.map(p => '<div class="odiff-point'+(reportReviewPoints(g.report).includes(p)&&p.review_status==='paired_excerpt'?' report-review':'')+'"><h3>'+(reportReviewPoints(g.report).includes(p)&&p.review_status==='paired_excerpt'?'🔴 교차검증 필요 · ':'') + esc(REPORT_ASPECTS[p.aspect] || '표현') + '</h3><div class="odiff-pair"><div><b>현재 기사</b><blockquote>' + esc(p.article_quote) + '</blockquote></div><div><b>'+(g.report.original_candidate?'원문 후보':'원문')+'</b><blockquote>' + esc(p.related_quote) + '</blockquote>' + (p.related_quote_ko ? '<b>AI 한국어 번역</b><blockquote>' + esc(p.related_quote_ko) + '</blockquote>' : '') + '</div></div>' + (p.explanation ? '<p class="odiff-why"><b>무엇이 달라졌나요?</b> ' + esc(p.explanation) + '</p>' : '') + '</div>').join('') + '<button class="link-btn" data-report-review="'+esc(g.report.id)+'">관련 기사 상세에서 대조 보기</button>'
  ).join('') + '<p class="trace-note">AI가 두 본문의 구절을 짝지어 찾은 차이예요. 어느 쪽이 맞는지는 판단하지 않으니 직접 확인해 주세요.</p></section>';
}


export function renderAnalysis(container, a, expanded = new Set()) {
  const sections=sectionData(a);
  const summary=a.ui_state?'<p>'+esc(a.one_line_summary)+'</p>':'<ul class="summary-list">'+summaryLines(a.one_line_summary).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>';
  container.innerHTML = headlineCard(a,expanded) + (a.is_demo ? '<div class="demo-banner" role="status">시연용 예시 · 실제 기사나 실제 출처 분석 결과가 아닙니다.</div>' : '') + noticeStrip(a) + diffCard(a) +
    '<div class="overview-grid"><div class="analysis-summary"><span>'+(a.ui_state==='loading'?'분석 중':a.ui_state==='error'?'분석 요청 실패':a.analysis_status==='partial'?'부분 분석':'출처 분석 완료')+'</span><h2>기사 요약</h2>'+summary+'</div>'+sectionMarkup(a,sections.find(s=>s.id==='metadata'),expanded)+'</div>'+
    '<div class="analysis-grid">'+sections.filter(s=>s.id!=='metadata').map(s=>sectionMarkup(a,s,expanded)).join('')+'</div>'+
    '<div class="card"><h2>제목과 본문 표현의 차이</h2><p>' + esc(a.headline_difference) + '</p><p class="trace-note">' + esc(a.final_comment) + '</p><p class="muted">분석 시각: ' + esc(a.analyzed_at) + '</p></div>';
  const setSectionOpen = (id,open) => {
    const button=container.querySelector('[data-toggle="'+id+'"]');
    if(open)expanded.add(id);else expanded.delete(id);
    button.setAttribute('aria-expanded', String(expanded.has(id)));
    const section=sections.find(s=>s.id===id);
    button.textContent = expanded.has(id) ? '접기 ∧' : moreLabel(section);
    button.setAttribute('aria-label',section.title+' '+(expanded.has(id)?'접기':(section.more || '자세히 보기')));
    container.querySelector('#details-' + id).hidden = !expanded.has(id);
    container.querySelector('#summary-' + id).hidden = expanded.has(id);
  };
  container.onclick = e => {
    const reportJump=e.target.closest('[data-report-review]');
    if(reportJump) {
      const id=reportJump.dataset.reportReview;
      if(!a.related_articles.some(r=>r.id===id))return;
      setSectionOpen('related',true);
      const target=container.ownerDocument.getElementById('related-report-'+id);
      if(target){target.open=true;target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView?.({behavior:'smooth',block:'start'});}
      return;
    }
    const toggle=e.target.closest('[data-headline-toggle]');
    if(toggle){
      if(expanded.has('headline'))expanded.delete('headline');else expanded.add('headline');
      toggle.setAttribute('aria-expanded',String(expanded.has('headline')));
      toggle.setAttribute('aria-label','제목의 의미와 뒷받침하는 내용 '+(expanded.has('headline')?'접기':'자세히 보기'));
      toggle.textContent=expanded.has('headline')?'접기 ∧':'자세히 보기 ›';
      container.querySelector('#headline-details').hidden=!expanded.has('headline');
      container.querySelector('#headline-summary').hidden=expanded.has('headline');
      return;
    }
    const jump=e.target.closest('[data-headline-jump]');
    if(jump){
      const reason=a.headline_explanation?.reasons[Number(jump.dataset.headlineJump)];
      if(!reason)return;
      const mid=reason.mention_ids.find(id=>a.evidence_mentions.some(m=>m.id===id));
      const sid=reason.source_ids.find(id=>citedSources(a).some(s=>s.id===id));
      // 연결된 근거가 없으면 '기사의 주장과 근거' 카드로 이동한다
      let target=container.querySelector('[data-section="claims"]');
      if(mid || sid){
        setSectionOpen('claims',true);
        target=container.ownerDocument.getElementById(mid?'evidence-mention-'+mid:'evidence-source-'+sid);
      }
      if(target){
        target.setAttribute('tabindex','-1');target.classList.add('jump-target');
        target.focus({preventScroll:true});
        target.scrollIntoView?.({behavior:'smooth',block:'start'});
        setTimeout(()=>target.classList.remove('jump-target'),1600);
      }
      return;
    }
    const button = e.target.closest('[data-toggle]');
    if(button)setSectionOpen(button.dataset.toggle,!expanded.has(button.dataset.toggle));
  };
}
export function renderAnalysisState(container,article,status,message,expanded=new Set()) {
  const empty={url:article.url,title:article.title,publisher:null,author:null,published_at:null,updated_at:null,event_time:null,event_location:null,author_profile_url:null,...article};
  renderAnalysis(container,{is_demo:false,article:empty,ui_state:status,analysis_status:'partial',one_line_summary:message,context_timeline:[],claims:[],evidence_mentions:[],sources:[],related_articles:[],caution:{status:'unknown',reasons:[message]},search_errors:[],headline_difference:'분석 결과를 기다리는 중입니다.',final_comment:'기본 정보는 페이지에서 수집한 값이며 출처 분석 결과는 아직 없습니다.',analyzed_at:'분석 전',section_states:Object.fromEntries(['context','metadata','claims','evidence','cautions','related'].map(id=>[id,{status:id==='metadata'?'ready':status,message:id==='metadata'?'페이지에서 수집':message}]))},expanded);
  if(status==='error')container.insertAdjacentHTML('afterbegin','<button class="btn" data-retry>다시 시도</button>');
}
export function renderPreview(p) {
  return (p.is_demo ? '<p class="demo-banner">시연용 예시 · 실제 AI 분석이 아닙니다.</p>' : '') + '<h3>핵심 요약</h3>'+list(summaryLines(p.summary))+
    (p.headline_difference?'<h3>제목·본문 표현 차이</h3><p>'+esc(p.headline_difference)+'</p>':'')+
    '<p class="trace-note">출처와 자세한 근거는 오른쪽 분석 패널에서 확인하세요.</p>';
}
export function renderSelection(r) {
  return (r.is_demo ? '<p class="demo-banner">시연용 예시</p>' : '') + '<h3>선택한 문장</h3><blockquote>'+esc(r.selected_text)+'</blockquote>'+
    (r.context_scope==='page_excerpt'?'<p class="trace-note">선택한 글과 주변 문맥 기준입니다. 기사 전체 분석이 아닙니다.</p>':'')+
    '<h3>문장 유형과 출처</h3>'+(r.analysis_id?'<p class="trace-note">'+(r.matched_claim_ids?.length?'기사의 핵심 주장 분석을 재사용했습니다.':'선택 문장을 별도로 분석했습니다.')+'</p>':'') + r.claims.map(c => '<p>' + pill(TYPE_LABELS[c.claim_type]) + ' ' + pill(SOURCE_LABELS[c.source_status]) + '</p><blockquote>' + esc(c.original_text) + '</blockquote>' + translationLine(c)).join('') +
    r.sources.map(s => sourceSummary(s,r.is_demo)).join('') + pill(CAUTION_LABELS[r.caution.status],r.caution.status === 'caution') + decisionDetails(r.caution,r.sources,r.is_demo) + errorList(r.pipeline_errors) + '<p class="trace-note">출처 확인 상태이며 사실·거짓 판정이 아닙니다.</p>';
}
export function renderWord(r) {
  const verified=['found','search_only'].includes(r.dictionary_status);
  return (r.is_demo?'<p class="demo-banner">시연용 예시 · 실제 사전 조회가 아닙니다.</p>':'')+
    '<h3>선택한 단어</h3><blockquote>'+esc(r.selected_text)+'</blockquote><p class="trace-note">표제어: '+esc(r.lemma)+'</p>'+
    '<h3>'+(verified?'사전 자료의 의미':'일반적 의미 · AI 설명')+'</h3><p>'+esc(verified?r.dictionary_meaning:r.general_meaning)+'</p>'+
    (!verified?'<p class="trace-note">'+(r.dictionary_status==='failed'?'사전 검색 실패':'사전 뜻풀이 미확인')+' · 사전에서 확인한 정의로 단정하지 않습니다.</p>':'')+
    r.dictionary_sources.map(s=>'<p>'+safeLink(s.url,s.title,r.is_demo)+'</p><blockquote>'+esc(s.excerpt)+'</blockquote><p class="trace-note">'+(s.basis==='search_snippet'?'사전 검색 요약 기준 · 원문은 확인하지 못했습니다.':'확보한 사전 자료 기준')+'</p>').join('')+
    '<h3>이 문맥에서의 의미</h3><p>'+esc(r.contextual_meaning || '주변 문맥이 부족하거나 인용을 확인하지 못해 의미를 특정하기 어렵습니다.')+'</p>'+
    (r.context_quote?'<blockquote>'+esc(r.context_quote)+'</blockquote>':'')+errorList(r.pipeline_errors)+
    '<p class="trace-note">문맥 설명은 AI의 해석이며 사실 여부나 출처 신뢰도 판정이 아닙니다.</p>';
}
