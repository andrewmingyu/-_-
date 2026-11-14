import { traceSummary, TRACE_NOTE, credibility, CRED_NOTE } from './summary.js';

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
function citedSources(a) { return (a.sources || []).filter(s => s.discovery === 'article_cited'); }
// 근거마다 어떤 주장의 근거인지 표시 (주장 번호는 기사의 주장 카드 순서)
function claimTags(a, ids) {
  const nums = (a.claims || []).flatMap((c, i) => (ids || []).includes(c.id) ? [i + 1] : []);
  return nums.length ? nums.map(n => '<span class="trace-badge claim-no">주장 ' + n + '의 근거</span>').join('') : '<span class="trace-badge">연결된 주장 없음</span>';
}
function cautionContent(a, detailed) {
  const key = text => String(text).replace(/\s+/g,' ').trim().replace(/[.!。]+$/,'').trim();
  const boilerplate = new Set([
    '확보한 출처 정보에서 별도의 주의사항을 발견하지 못했습니다. 주장 진위의 판정은 아닙니다.',
    '원본 자료 확인은 주장의 진실성을 입증하지 않습니다.',
    '출처 확인은 주장의 진실성을 입증하지 않습니다.',
    '주의사항의 존재나 부재는 주장 진위의 판정이 아닙니다.'
  ].map(key));
  const items = new Map(), missing = new Set(), missingSources = new Set(), missingClaims = new Set();
  const errors = [...new Map((a.search_errors || []).map(text=>[key(text),text])).values()];
  const errorKeys = new Set(errors.map(key));
  const cited = citedSources(a), citedIds = new Set(cited.map(s => s.id));
  for (const source of cited) {
    if (!source.unknown_fields?.length) continue;
    missingSources.add(source.id);
    for (const field of source.unknown_fields) missing.add(FACT_LABELS[field] || field);
  }
  // Merge duplicate explanations without losing source/claim references or reasons lacking details.
  for (const item of [...(a.caution.details || []), ...a.caution.reasons.map(reason=>({reason}))]) {
    const text = String(item.reason).replace(/\s+/g,' ').trim(), normalized = key(text);
    if (!normalized) continue;
    // 외부 검색 자료에만 해당하는 주의 문구는 표시하지 않음 (기사와 연결된 자료 기준)
    if (item.source_ids?.length && !item.claim_ids?.length && !item.source_ids.some(id => citedIds.has(id))) continue;
    if (text.startsWith('출처 속성을 확인하지 못했습니다:')) {
      text.split(':').slice(1).join(':').split(',').map(s=>s.trim()).filter(Boolean).forEach(s=>missing.add(s));
      (item.source_ids || []).forEach(id=>missingSources.add(id));
      (item.claim_ids || []).forEach(id=>missingClaims.add(id));
      continue;
    }
    // The status badge and error section already explain these boilerplate messages.
    if (boilerplate.has(normalized)) continue;
    if (errorKeys.has(normalized) || (errors.length && text === '원출처 검색 요청이 실패하여 분석이 불완전합니다.')) continue;
    const row = items.get(normalized) || {text,source_ids:new Set(),claim_ids:new Set()};
    (item.source_ids || []).forEach(id=>row.source_ids.add(id));
    (item.claim_ids || []).forEach(id=>row.claim_ids.add(id));
    items.set(normalized,row);
  }
  const refs = (sourceIds,claimIds) => {
    const labels = a.claims.flatMap((c,i)=>claimIds.has(c.id)?['주장 '+(i+1)]:[]).map(esc);
    labels.push(...cited.filter(s=>sourceIds.has(s.id)).map(s=>safeLink(s.url,s.title,a.is_demo)));
    return labels.length?'<p class="muted">관련: '+labels.join(' · ')+'</p>':'';
  };
  const rows = [...items.values()];
  const missingText = missing.size?'확인하지 못한 출처 정보: '+[...missing].join(', '):'';
  if (!detailed) return list([...rows.map(r=>r.text),...errors,...(missingText?[missingText]:[])].slice(0,3));
  const sections = [];
  if (rows.length) sections.push('<div class="caution-group"><h3>주의가 필요한 내용</h3><ul>'+rows.map(r=>'<li class="caution-item">'+esc(r.text)+refs(r.source_ids,r.claim_ids)+'</li>').join('')+'</ul></div>');
  if (missing.size) sections.push('<div class="caution-group"><h3>확인하지 못한 출처 정보</h3><p>'+esc([...missing].join(', '))+'</p>'+refs(missingSources,missingClaims)+'</div>');
  if (errors.length) sections.push('<div class="caution-group"><h3>분석 중 발생한 문제</h3>'+list(errors)+'</div>');
  return sections.join('');
}
function cautions(a, detailed) {
  return pill(CAUTION_LABELS[a.caution.status], a.caution.status === 'caution') + cautionContent(a,detailed) +
    '<p class="trace-note">주의사항의 존재나 부재는 주장 진위의 판정이 아닙니다.</p>';
}
function reportComparison(report,detailed) {
  const points=report.comparison_points || [];
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
    '<div class="comparison-point"><h3>'+esc(point.kind==='common'?'공통으로 다룬 내용':'표현·강조가 다른 부분')+' · '+esc(REPORT_ASPECTS[point.aspect])+'</h3><div class="report-pair"><div><b>현재 기사</b><blockquote>'+esc(point.article_quote)+'</blockquote><button class="link-btn" data-quote="'+esc(point.article_quote)+'">본문에서 보기</button></div><div><b>비교 보도</b><blockquote>'+esc(point.related_quote)+'</blockquote></div></div></div>'
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
    (index?'<span class="context-arrow" aria-hidden="true">→</span>':'')+'<div class="context-step'+(node.is_main_event?' context-main':'')+'" role="listitem"'+(node.is_main_event?' aria-label="주요 사건"':'')+'><span class="context-date">'+esc(node.date)+'</span>'+(node.is_main_event?'<span class="context-main-label">주요 사건</span>':'')+'<p title="'+esc(node.description)+'">'+esc(node.label || (node.is_main_event?'주요 사건':'배경 정보'))+'</p></div>'
  ).join('')+'</div>';
}
function headlineCard(a,expanded) {
  const h=a.headline_explanation, reasons=h?.reasons || [];
  const available=Boolean(h?.meaning && reasons.length);
  const message=a.ui_state==='loading'?'기사 본문에서 제목의 의미와 이유를 읽는 중입니다.':a.ui_state==='error'?'제목 설명을 불러오지 못했습니다. 다시 분석해 주세요.':'제목 설명이 아직 없습니다. 다시 분석해 주세요.';
  const open=expanded.has('headline');
  return '<section class="card headline-explanation" aria-labelledby="headline-explanation-title"><div class="headline-heading"><h2 id="headline-explanation-title">제목의 의미</h2>'+(a.is_demo?'<span class="trace-badge">시연용</span>':'')+
    (available?'<button class="btn" data-headline-toggle aria-label="제목의 의미와 이유 '+(open?'접기':'자세히 보기')+'" aria-expanded="'+open+'" aria-controls="headline-details">'+(open?'접기 ∧':'자세히 보기 ›')+'</button>':'')+'</div>'+
    (available?'<p class="headline-meaning">'+esc(h.meaning)+'</p><h3 class="headline-reasons-title">이유</h3><ul class="headline-reasons">'+reasons.map(r=>'<li>'+esc(reasonPhrase(r.text))+'</li>').join('')+'</ul>'+
    '<div id="headline-details"'+(open?'':' hidden')+'>'+reasons.map((r,i)=>'<div class="headline-reason-detail"><h3>이유 '+(i+1)+'</h3><p>'+esc(reasonPhrase(r.text))+'</p><blockquote>'+esc(r.article_quote)+'</blockquote><button class="link-btn" data-headline-jump="'+i+'">'+(r.mention_ids.some(id=>a.evidence_mentions.some(m=>m.id===id)) || r.source_ids.some(id=>citedSources(a).some(s=>s.id===id))?'이 이유의 근거 보기 →':'근거 확인 현황 보기 →')+'</button></div>').join('')+'</div>':'<p class="muted">'+esc(message)+'</p>')+'</section>';
}
function relatedList(items,demo,detailed=false) {
  if(!items.length)return '<p class="muted">관련 기사 없음</p>';
  const row=(report,link)=>'<span class="related-press" title="'+esc(report.publisher || '언론사 미확인')+'">'+esc(report.publisher || '언론사 미확인')+'</span><span class="related-title" title="'+esc(report.title)+'">'+(link?safeLink(report.url,report.title,demo):esc(report.title))+'</span><span class="related-date" title="'+esc(report.published_at || '작성일 미확인')+'">'+esc(report.published_at?compactDate(report.published_at).slice(0,10):'날짜 미확인')+'</span>';
  if(!detailed)return '<ul class="related-list">'+items.map(report=>'<li class="related-row">'+row(report,true)+'</li>').join('')+'</ul>';
  return '<div class="related-details">'+items.map(report=>'<details class="report-detail"><summary class="related-row">'+row(report,false)+'<span class="report-open" aria-hidden="true">⌄</span></summary><div class="report-body"><p>'+safeLink(report.url,'원문 기사 열기',demo)+'</p>'+reportComparison(report,true)+'<p class="muted">'+esc(report.independence)+'</p></div></details>').join('')+'</div><p class="trace-note">공통 보도는 사실 확인을 뜻하지 않으며 표현 차이만으로 어느 쪽이 맞는지 판단하지 않습니다.</p>';
}
export function sectionData(a) {
  const article = a.article;
  const metadata = '<dl>' + [['언론사',article.publisher],['기자',article.author],['작성일',article.published_at?compactDate(article.published_at):null]].map(([k,v]) => '<dt>' + k + '</dt><dd>' + esc(v || '미확인') + '</dd>').join('') + '</dl>';
  const timeline = contextFlow(a);
  const event=a.event?.description?'<details class="event-original"><summary>핵심 사건 원문</summary><blockquote>'+esc(a.event.article_quote || a.event.description)+'</blockquote></details>':'';
  const timelineDetails = a.context_timeline.map(t=>'<div class="source-row"><p>'+esc(t.date+' → '+t.description)+'</p><button class="link-btn" data-quote="'+esc(t.article_quote)+'">본문에서 보기</button>'+(t.source_ids||[]).map(id=>a.sources.find(s=>s.id===id)).filter(Boolean).map(s=>'<p>'+safeLink(s.url,s.title,a.is_demo)+'</p>').join('')+'</div>').join('');
  const claimSummary = list(a.claims.slice(0,2).map((c,i) => '주장 ' + (i+1) + ' · ' + translated(c, c.claim_text)));
  const cited = citedSources(a);
  const mentionRow = m => {
    const claims = a.claims.filter(c => m.claim_ids.includes(c.id));
    const sources = cited.filter(s => s.mention_ids.includes(m.id));
    return '<div class="source-row">' + claimTags(a, m.claim_ids) + '<strong>' + esc(translated(m, m.description)) + '</strong><p>기사의 출처 표기: ' + esc(m.source_label || '명시되지 않음') + '</p>' + [...new Set(claims.map(c => SOURCE_LABELS[c.source_status]))].map(l => pill(l)).join('') + sources.slice(0,1).map(s => '<p>' + safeLink(s.url,s.title,a.is_demo) + '</p><p class="compact-summary">' + esc(s.summary) + '</p>').join('') + '</div>';
  };
  const mentionDetail = m => {
    const sources = cited.filter(s => s.mention_ids.includes(m.id));
    return '<div class="source-row" id="evidence-mention-'+esc(m.id)+'">' + claimTags(a, m.claim_ids) + '<p>기사에서 제시한 근거: ' + esc(m.article_quote) + '</p>' + translationLine(m) + '<p>기사의 출처 표기: ' + esc(m.source_label || '명시되지 않음') + ' · 자료 종류: ' + esc(kindLabel(m.source_kind)) + '</p><button class="link-btn" data-quote="' + esc(m.article_quote) + '">본문에서 보기</button>' +
      (sources.length ? sources.map(s => '<div id="evidence-source-'+esc(s.id)+'">'+sourceDetails(s,a.is_demo)+'</div>').join('') : '<p class="muted">이 근거의 원문 자료는 확보하지 못했습니다.</p>') + '</div>';
  };
  const linked = new Set(a.evidence_mentions.flatMap(m => cited.filter(s => s.mention_ids.includes(m.id)).map(s => s.id)));
  const otherCited = cited.filter(s => !linked.has(s.id));
  const mentions = a.evidence_mentions.slice(0,2).map(mentionRow).join('');
  // Prefer articles from different publishers. Unknown publisher uses hostname.
  const seen = new Set();
  const related = a.related_articles.filter(r => { let key; try { key = r.publisher || new URL(r.url).hostname; } catch { return false; } if (seen.has(key)) return false; seen.add(key); return true; });
  const compactMetadata='<dl class="compact-meta">'+[['언론사',article.publisher],['기자',article.author],['작성일',compactDate(article.published_at)]].map(([label,value])=>'<div><dt>'+label+'</dt><dd title="'+esc(value || '미확인')+'">'+esc(value || '미확인')+'</dd></div>').join('')+'</dl>';
  return [
    {id:'context',title:'배경 및 맥락',summary:timeline,details:timeline+event+timelineDetails + '<p class="trace-note">기사에서 확인한 흐름이며 화살표가 인과관계를 입증하는 것은 아닙니다.</p>'},
    {id:'metadata',title:'기사 기본 정보',summary:compactMetadata,details:metadata + '<dl><dt>수정일</dt><dd>' + esc(article.updated_at?compactDate(article.updated_at):'미확인') + '</dd><dt>원문</dt><dd>' + safeLink(article.url,'기사 원문',a.is_demo) + '</dd><dt>기자 정보</dt><dd>' + (article.author_profile_url ? safeLink(article.author_profile_url,'공개 프로필',a.is_demo) : '확인 가능한 공개 프로필 없음') + '</dd></dl>'},
    {id:'claims',title:'기사의 주장',summary:claimSummary,details:a.claims.map((c,i) => '<div class="source-row"><span class="trace-badge claim-no">주장 ' + (i+1) + '</span>' + pill(TYPE_LABELS[c.claim_type]) + '<blockquote>' + esc(c.original_text) + '</blockquote>' + translationLine(c) + '<p>발언자: ' + esc(c.speaker || '미확인') + '</p><button class="link-btn" data-quote="' + esc(c.original_text) + '">본문에서 보기</button></div>').join('') || '<p>추출된 주장 없음</p>'},
    {id:'evidence',title:'내용의 근거',summary:(mentions || '<p class="muted">기사가 직접 제시한 근거가 없습니다.</p>') + (a.evidence_mentions.length && !cited.length ? '<p>기사가 제시한 근거의 원문 자료를 아직 확보하지 못했습니다.</p>' : ''),details:(a.evidence_mentions.map(mentionDetail).join('') || '<p class="muted">기사가 직접 제시한 근거가 없습니다.</p>') + (otherCited.length ? '<h3>기사에 언급된 기타 자료</h3>' + otherCited.map(s => '<div id="evidence-source-'+esc(s.id)+'">'+sourceDetails(s,a.is_demo)+'</div>').join('') : '') + '<p class="trace-note">기사 안에서 제시된 근거만 보여줍니다. 외부 검색으로 찾은 자료는 근거로 표시하지 않습니다.</p>'},
    {id:'cautions',title:'주의할 것',summary:cautions(a,false),details:cautions(a,true)},
    {id:'related',title:'비슷한 주제의 기사',summary:relatedList(related.slice(0,5),a.is_demo),details:relatedList(related,a.is_demo,true)}
  ];
}
function sectionMarkup(a,s,expanded) {
  const state=a.section_states?.[s.id];
  const status=state&&s.id!=='metadata'?'<p class="section-state" role="status">'+esc(({ready:'정보 준비됨',empty:'확인된 정보 없음',partial:'일부 정보 미확인',error:'처리 실패',loading:'분석 중'})[state.status] || '상태 미확인')+(state.message?' · '+esc(state.message):'')+'</p>':'';
  return '<section class="card analysis-section'+(s.id==='metadata'?' compact-metadata':'')+'" data-section="'+s.id+'"><div class="section-heading"><h2>'+s.title+'</h2><button type="button" data-toggle="'+s.id+'" aria-label="'+s.title+' '+(expanded.has(s.id)?'접기':'자세히 보기')+'" aria-expanded="'+expanded.has(s.id)+'" aria-controls="details-'+s.id+'">'+(expanded.has(s.id)?'접기 ∧':'자세히 보기 ›')+'</button></div>'+status+'<div id="summary-'+s.id+'"'+(expanded.has(s.id)?' hidden':'')+'>'+s.summary+'</div><div id="details-'+s.id+'"'+(!expanded.has(s.id)?' hidden':'')+'>'+s.details+'</div></section>';
}

function credStrip(a) {
  const c = credibility(a);
  if (!c) return '';
  const rows = c.factors.map(f => '<li><span class="ncs-name">' + esc(f.label) + '</span><span class="ncs-score">' + f.score + '점</span><span class="ncs-detail">' + esc(f.detail) + '</span></li>').join('');
  const skipped = c.unmeasured.length ? '<p class="trace-note">계산에서 제외: ' + esc(c.unmeasured.join(', ')) + '</p>' : '';
  return '<section class="card ncs ncs-' + c.level + '" aria-label="종합 신뢰 지수"><div class="ncs-top"><span class="ncs-level">' + c.icon + ' ' + esc(c.text) + '</span>' +
    (c.percent === null ? '' : '<span class="ncs-pct">' + c.percent + '%</span>') + '</div>' +
    (c.percent === null ? '' : '<div class="ncs-bar" role="img" aria-label="신뢰 지수 ' + c.percent + '퍼센트"><i style="width:' + c.percent + '%"></i></div>') +
    '<p class="trace-headline">' + esc(c.hint) + '</p><ul class="ncs-list">' + rows + '</ul>' + skipped +
    '<p class="trace-note">사진 자료의 날짜는 읽지 못해 반영하지 않았어요.</p><p class="trace-note">' + esc(CRED_NOTE) + '</p></section>';
}

// 기사가 인용한 원문(원본으로 확인된 출처)과 비교해 서술이 달라진 부분을 첫 화면에 바로 보여 준다.
function originalDiffs(a) {
  const trim = u => String(u).replace(/\/$/, '');
  const originals = new Set((a.sources || []).filter(s => s.original_status === 'original_found').map(s => trim(s.url)));
  return (a.related_articles || []).filter(r => r.comparison_status === 'compared' && originals.has(trim(r.url)))
    .map(r => ({ report: r, points: (r.comparison_points || []).filter(p => p.kind === 'difference') }))
    .filter(x => x.points.length);
}

function diffCard(a) {
  const groups = originalDiffs(a);
  if (!groups.length) return '';
  const total = groups.reduce((n, g) => n + g.points.length, 0);
  return '<section class="card odiff" aria-label="원문과 다른 점"><h2>원문과 다른 점 ' + total + '건</h2>' + groups.map(g =>
    '<p class="trace-headline">기사가 인용한 원문 ' + safeLink(g.report.url, g.report.title, a.is_demo) + '과 비교해 서술이 달라진 부분이에요.</p>' +
    g.points.map(p => '<div class="odiff-point"><h3>' + esc(REPORT_ASPECTS[p.aspect] || '표현') + '</h3><div class="odiff-pair"><div><b>현재 기사</b><blockquote>' + esc(p.article_quote) + '</blockquote></div><div><b>원문</b><blockquote>' + esc(p.related_quote) + '</blockquote>' + (p.related_quote_ko ? '<b>한국어 번역</b><blockquote>' + esc(p.related_quote_ko) + '</blockquote>' : '') + '</div></div>' + (p.explanation ? '<p class="odiff-why"><b>무엇이 달라졌나요?</b> ' + esc(p.explanation) + '</p>' : '') + '</div>').join('')
  ).join('') + '<p class="trace-note">AI가 두 본문의 구절을 짝지어 찾은 차이예요. 어느 쪽이 맞는지는 판단하지 않으니 직접 확인해 주세요.</p></section>';
}

function traceStrip(a) {
  const t = traceSummary(a);
  if (!t) return '';
  const cells = t.cells.map(c => '<span class="trace-cell trace-' + c.key + '" title="' + esc(c.label) + '"></span>').join('');
  const legend = t.legend.map(l => '<li><i class="trace-dot trace-' + l.key + '" aria-hidden="true"></i>' + esc(l.label) + ' ' + l.count + '</li>').join('');
  const aria = t.legend.map(l => l.label + ' ' + l.count).join(', ');
  return '<section class="card trace-strip" id="trace-overview" tabindex="-1" aria-label="근거 확인 현황"><div class="trace-top"><span class="trace-kicker">근거 확인 현황</span>' +
    (t.caution ? '<span class="trace-badge caution">주의할 점 ' + (t.cautionCount ? t.cautionCount + '건' : '있음') + '</span>' : '') +
    (t.partial ? '<span class="trace-badge">일부 단계 미완료</span>' : '') + '</div>' +
    '<p class="trace-headline">' + esc(t.headline) + '</p>' +
    (t.total ? '<div class="trace-cells" role="img" aria-label="' + esc(aria) + '">' + cells + '</div><ul class="trace-legend">' + legend + '</ul>' : '') +
    '<p class="trace-note">' + esc(TRACE_NOTE) + '</p></section>';
}

export function renderAnalysis(container, a, expanded = new Set()) {
  const sections=sectionData(a);
  const summary=a.ui_state?'<p>'+esc(a.one_line_summary)+'</p>':'<ul class="summary-list">'+summaryLines(a.one_line_summary).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>';
  container.innerHTML = headlineCard(a,expanded) + (a.is_demo ? '<div class="demo-banner" role="status">시연용 예시 · 실제 기사나 실제 출처 분석 결과가 아닙니다.</div>' : '') + credStrip(a) + diffCard(a) + traceStrip(a) +
    '<div class="overview-grid"><div class="analysis-summary"><span>'+(a.ui_state==='loading'?'분석 중':a.ui_state==='error'?'분석 요청 실패':a.analysis_status==='partial'?'부분 분석':'출처 분석 완료')+'</span><h2>한 줄 요약</h2>'+summary+'</div>'+sectionMarkup(a,sections.find(s=>s.id==='metadata'),expanded)+'</div>'+errorList(a.pipeline_errors)+
    '<div class="analysis-grid">'+sections.filter(s=>s.id!=='metadata').map(s=>sectionMarkup(a,s,expanded)).join('')+'</div>'+
    '<div class="card"><h2>제목과 본문 표현의 차이</h2><p>' + esc(a.headline_difference) + '</p><p class="trace-note">' + esc(a.final_comment) + '</p><p class="muted">분석 시각: ' + esc(a.analyzed_at) + '</p></div>';
  const setSectionOpen = (id,open) => {
    const button=container.querySelector('[data-toggle="'+id+'"]');
    if(open)expanded.add(id);else expanded.delete(id);
    button.setAttribute('aria-expanded', String(expanded.has(id)));
    button.textContent = expanded.has(id) ? '접기 ∧' : '자세히 보기 ›';
    button.setAttribute('aria-label',sections.find(s=>s.id===id).title+' '+(expanded.has(id)?'접기':'자세히 보기'));
    container.querySelector('#details-' + id).hidden = !expanded.has(id);
    container.querySelector('#summary-' + id).hidden = expanded.has(id);
  };
  container.onclick = e => {
    const toggle=e.target.closest('[data-headline-toggle]');
    if(toggle){
      if(expanded.has('headline'))expanded.delete('headline');else expanded.add('headline');
      toggle.setAttribute('aria-expanded',String(expanded.has('headline')));
      toggle.setAttribute('aria-label','제목의 의미와 이유 '+(expanded.has('headline')?'접기':'자세히 보기'));
      toggle.textContent=expanded.has('headline')?'접기 ∧':'자세히 보기 ›';
      container.querySelector('#headline-details').hidden=!expanded.has('headline');
      return;
    }
    const jump=e.target.closest('[data-headline-jump]');
    if(jump){
      const reason=a.headline_explanation?.reasons[Number(jump.dataset.headlineJump)];
      if(!reason)return;
      const mid=reason.mention_ids.find(id=>a.evidence_mentions.some(m=>m.id===id));
      const sid=reason.source_ids.find(id=>citedSources(a).some(s=>s.id===id));
      let target=container.querySelector('#trace-overview');
      if(mid || sid){
        setSectionOpen('evidence',true);
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
  return (r.is_demo ? '<p class="demo-banner">시연용 예시</p>' : '') + '<h3>문장 유형과 출처</h3>'+(r.analysis_id?'<p class="trace-note">'+(r.matched_claim_ids?.length?'기사의 핵심 주장 분석을 재사용했습니다.':'선택 문장을 별도로 분석했습니다.')+'</p>':'') + r.claims.map(c => '<p>' + pill(TYPE_LABELS[c.claim_type]) + ' ' + pill(SOURCE_LABELS[c.source_status]) + '</p><blockquote>' + esc(c.original_text) + '</blockquote>' + translationLine(c)).join('') +
    r.sources.map(s => sourceSummary(s,r.is_demo)).join('') + pill(CAUTION_LABELS[r.caution.status],r.caution.status === 'caution') + decisionDetails(r.caution,r.sources,r.is_demo) + errorList(r.pipeline_errors) + '<p class="trace-note">출처 확인 상태이며 사실·거짓 판정이 아닙니다.</p>';
}
