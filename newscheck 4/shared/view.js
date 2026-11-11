export const SOURCE_LABELS = { original_found: '원본 자료 확인', secondary_only: '재인용 자료만 확인', source_not_found: '원출처를 찾지 못함', unknown: '확인에 필요한 정보 부족' };
export const CAUTION_LABELS = { caution: '주의사항 표시 필요', none_identified: '현재 별도 주의사항을 발견하지 못함', unknown: '출처 분석 정보 부족' };
export const TYPE_LABELS = { factual_narration: '사실 서술', quotation: '발언·인용', opinion: '의견', interpretation: '해석', prediction: '예측', context: '배경·맥락', statistics: '통계·연구', unknown: '유형 미확인' };
const FACT_LABELS = { identity: '작성기관', authorship:'작성자', originality: '원자료·재인용 관계', expertise: '전문성', information_access: '정보 접근 경로', date_context: '작성 시점', public_access: '공개·검증 가능성', methodology: '조사 방법', interests: '이해관계', independence: '독립 자료 여부' };
const KIND_LABELS={official_release:'공식 발표·보도자료',public_record:'정부·공공기관 자료',research:'연구·논문',statistics:'통계',interview:'인터뷰',expert_comment:'전문가 발언',news_report:'언론 보도',anonymous_statement:'익명 관계자 발언',unknown:'종류 미확인'};
const kindLabel=value=>KIND_LABELS[value] || value;
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
  return sourceSummary(s, demo) + '<dl><dt>발행기관</dt><dd>' + esc(s.publisher || '확인하지 못함') + '</dd><dt>발행일</dt><dd>' + esc(s.published_at || '확인하지 못함') + '</dd><dt>자료 종류</dt><dd>' + esc(kindLabel(s.source_kind)) + '</dd><dt>원문 URL</dt><dd>' + safeLink(s.url, s.url, demo) + '</dd>' +
    Object.entries(FACT_LABELS).map(([k,label]) => '<dt>' + label + '</dt><dd>' + esc(s.facts[k]?.excerpt || '확인하지 못함') + '</dd>').join('') +
    '</dl><p class="trace-note">출처 원문에 기재된 문구입니다. 전문성·이해관계 부재나 주장 진위를 독립적으로 보증하지 않습니다.</p><p>출처 분석 이유</p>' + decisionDetails(s.caution,[s],demo);
}
function cautions(a, detailed) {
  let rows = a.caution.reasons;
  if (!detailed) rows = rows.slice(0, 3);
  return pill(CAUTION_LABELS[a.caution.status], a.caution.status === 'caution') + (detailed?decisionDetails(a.caution,a.sources,a.is_demo):list(rows)) +
    (detailed ? '<h3>출처가 불명확한 정보</h3>' + list(a.claims.filter(c => c.source_status !== 'original_found').map(c => c.original_text + ' — ' + SOURCE_LABELS[c.source_status])) +
      '<h3>검증 가능성이 부족한 자료</h3>' + list(a.sources.filter(s => s.unknown_fields.length).map(s => s.title + ': ' + s.unknown_fields.join(', '))) +
      '<h3>기자·전문가의 해석이나 예측</h3>' + list(a.claims.filter(c => ['opinion','interpretation','prediction'].includes(c.claim_type)).map(c => c.original_text)) +
      '<h3>현재 확인하지 못한 정보</h3>' + list(a.search_errors.concat(a.sources.flatMap(s => s.unknown_fields.map(f => s.title + ': ' + f)))) +
      '<h3>추가로 확인하면 좋은 자료</h3><p>원문 전체, 조사 방법, 최신 발행본, 작성자의 이해관계 및 자료 간 인용 관계를 확인해 주세요.</p>' : '') +
    '<p class="trace-note">주의사항의 존재나 부재는 주장 진위의 판정이 아닙니다.</p>';
}
export function sectionData(a) {
  const article = a.article;
  const metadata = '<dl>' + [['언론사',article.publisher],['기자',article.author],['작성일',article.published_at],['사건 날짜',article.event_time],['장소',article.event_location]].map(([k,v]) => '<dt>' + k + '</dt><dd>' + esc(v || '미확인') + '</dd>').join('') + '</dl>';
  const event=a.event?.description?'<p class="compact-summary">핵심 사건: '+esc(a.event.description)+'</p>':'';
  const timeline = event + list(a.context_timeline.slice(0,3).map(t => t.date + ' → ' + t.description));
  const timelineDetails = a.context_timeline.map(t=>'<div class="source-row"><p>'+esc(t.date+' → '+t.description)+'</p><button class="link-btn" data-quote="'+esc(t.article_quote)+'">본문에서 보기</button>'+(t.source_ids||[]).map(id=>a.sources.find(s=>s.id===id)).filter(Boolean).map(s=>'<p>'+safeLink(s.url,s.title,a.is_demo)+'</p>').join('')+'</div>').join('');
  const claimSummary = list(a.claims.slice(0,2).map(c => c.claim_text));
  const mentionRow = m => {
    const claims = a.claims.filter(c => m.claim_ids.includes(c.id));
    const sources = a.sources.filter(s => s.mention_ids.includes(m.id));
    return '<div class="source-row"><strong>' + esc(m.description) + '</strong><p>기사의 출처 표기: ' + esc(m.source_label || '명시되지 않음') + '</p>' + claims.map(c => pill(SOURCE_LABELS[c.source_status])).join('') + sources.slice(0,1).map(s => '<p>' + safeLink(s.url,s.title,a.is_demo) + '</p><p class="compact-summary">' + esc(s.summary) + '</p>').join('') + '</div>';
  };
  const mentions = a.evidence_mentions.slice(0,2).map(mentionRow).join('');
  // Prefer articles from different publishers. Unknown publisher uses hostname.
  const seen = new Set();
  const related = a.related_articles.filter(r => { let key; try { key = r.publisher || new URL(r.url).hostname; } catch { return false; } if (seen.has(key)) return false; seen.add(key); return true; });
  const relatedRows = items => items.length ? items.map(r => '<div class="source-row">' + safeLink(r.url,r.title,a.is_demo) + '<p>' + esc((r.publisher || '언론사 미확인') + ' · ' + (r.published_at || '작성일 미확인')) + '</p>'+(r.topic?'<p class="muted">검색 주제: '+esc(r.topic)+'</p>':'')+'<p>' + esc(r.summary || r.differences_summary) + '</p><p class="muted">' + esc(r.independence) + '</p></div>').join('') : '<p class="muted">관련 기사 없음</p>';
  return [
    {id:'context',title:'배경 및 맥락',summary:timeline,details:event+timelineDetails + '<p>기사에 명시된 배경만 표시합니다.</p>'},
    {id:'metadata',title:'기사 기본 정보',summary:metadata,details:metadata + '<dl><dt>수정일</dt><dd>' + esc(article.updated_at || '미확인') + '</dd><dt>원문</dt><dd>' + safeLink(article.url,'기사 원문',a.is_demo) + '</dd><dt>기자 정보</dt><dd>' + (article.author_profile_url ? safeLink(article.author_profile_url,'공개 프로필',a.is_demo) : '확인 가능한 공개 프로필 없음') + '</dd></dl>'},
    {id:'claims',title:'기사의 주장',summary:claimSummary,details:a.claims.map(c => '<div class="source-row">' + pill(TYPE_LABELS[c.claim_type]) + '<blockquote>' + esc(c.original_text) + '</blockquote><p>발언자: ' + esc(c.speaker || '미확인') + '</p><button class="link-btn" data-quote="' + esc(c.original_text) + '">본문에서 보기</button></div>').join('') || '<p>추출된 주장 없음</p>'},
    {id:'evidence',title:'내용의 근거',summary:mentions + (!a.sources.length ? '<p>원출처 자료를 아직 확보하지 못했습니다.</p>' : '') + (a.sources.some(s => s.discovery === 'external_found') ? '<p class="muted">외부에서 추가 발견한 자료는 자세히 보기에서 구분합니다.</p>' : ''),details:a.evidence_mentions.map(m=>'<div class="source-row"><p>기사에서 제시한 근거: '+esc(m.article_quote)+'</p><p>자료 종류: '+esc(kindLabel(m.source_kind))+'</p><button class="link-btn" data-quote="'+esc(m.article_quote)+'">본문에서 보기</button></div>').join('') + a.sources.map(s => sourceDetails(s,a.is_demo)).join('')},
    {id:'cautions',title:'주의할 것',summary:cautions(a,false),details:cautions(a,true)},
    {id:'related',title:'비슷한 주제의 기사',summary:relatedRows(related.slice(0,3)),details:relatedRows(related)}
  ];
}
export function renderAnalysis(container, a, expanded = new Set()) {
  container.innerHTML = (a.is_demo ? '<div class="demo-banner" role="status">시연용 예시 · 실제 기사나 실제 출처 분석 결과가 아닙니다.</div>' : '') +
    '<div class="analysis-summary"><span>' + (a.ui_state==='loading'?'분석 중':a.ui_state==='error'?'분석 요청 실패':a.analysis_status === 'partial' ? '부분 분석' : '출처 분석 완료') + '</span><h2>한 줄 요약</h2><p>' + esc(a.one_line_summary) + '</p></div>' + errorList(a.pipeline_errors) +
    sectionData(a).map(s => {
      const state=a.section_states?.[s.id];
      const status=state?'<p class="section-state" role="status">'+esc(({ready:'정보 준비됨',empty:'확인된 정보 없음',partial:'일부 정보 미확인',error:'처리 실패',loading:'분석 중'})[state.status] || '상태 미확인')+(state.message?' · '+esc(state.message):'')+'</p>':'';
      return '<section class="card analysis-section" data-section="' + s.id + '"><div class="section-heading"><h2>' + s.title + '</h2><button type="button" data-toggle="' + s.id + '" aria-expanded="' + expanded.has(s.id) + '" aria-controls="details-' + s.id + '">' + (expanded.has(s.id) ? '접기 ∧' : '자세히 보기 ›') + '</button></div>'+status+'<div id="summary-' + s.id + '"' + (expanded.has(s.id) ? ' hidden' : '') + '>' + s.summary + '</div><div id="details-' + s.id + '"' + (!expanded.has(s.id) ? ' hidden' : '') + '>' + s.details + '</div></section>';
    }).join('') +
    '<div class="card"><h2>제목과 본문 표현의 차이</h2><p>' + esc(a.headline_difference) + '</p><p class="trace-note">' + esc(a.final_comment) + '</p><p class="muted">분석 시각: ' + esc(a.analyzed_at) + '</p></div>';
  container.onclick = e => {
    const button = e.target.closest('[data-toggle]');
    if (!button) return;
    const id = button.dataset.toggle;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    button.setAttribute('aria-expanded', String(expanded.has(id)));
    button.textContent = expanded.has(id) ? '접기 ∧' : '자세히 보기 ›';
    container.querySelector('#details-' + id).hidden = !expanded.has(id);
    container.querySelector('#summary-' + id).hidden = expanded.has(id);
  };
}
export function renderAnalysisState(container,article,status,message,expanded=new Set()) {
  const empty={url:article.url,title:article.title,publisher:null,author:null,published_at:null,updated_at:null,event_time:null,event_location:null,author_profile_url:null,...article};
  renderAnalysis(container,{is_demo:false,article:empty,ui_state:status,analysis_status:'partial',one_line_summary:message,context_timeline:[],claims:[],evidence_mentions:[],sources:[],related_articles:[],caution:{status:'unknown',reasons:[message]},search_errors:[],headline_difference:'분석 결과를 기다리는 중입니다.',final_comment:'기본 정보는 페이지에서 수집한 값이며 출처 분석 결과는 아직 없습니다.',analyzed_at:'분석 전',section_states:Object.fromEntries(['context','metadata','claims','evidence','cautions','related'].map(id=>[id,{status:id==='metadata'?'ready':status,message:id==='metadata'?'페이지에서 수집':message}]))},expanded);
  if(status==='error')container.insertAdjacentHTML('afterbegin','<button class="btn" data-retry>다시 시도</button>');
}
export function renderPreview(p) {
  return (p.is_demo ? '<p class="demo-banner">시연용 예시 · 실제 AI 분석이 아닙니다.</p>' : '') + '<h3>핵심 요약</h3><p>' + esc(p.summary) + '</p><h3>주요 주장</h3>'+list((p.claims||[]).map(c=>c.claim_text))+'<h3>주요 근거</h3>' + list(p.major_evidence.map(m => m.description)) +
    p.sources.slice(0,2).map(s => sourceSummary(s,p.is_demo)).join('') + '<h3>제목·본문 표현 차이</h3><p>' + esc(p.headline_difference) + '</p><h3>주의사항</h3><p>' + esc(p.one_line_caution) + '</p>'+errorList(p.pipeline_errors);
}
export function renderSelection(r) {
  return (r.is_demo ? '<p class="demo-banner">시연용 예시</p>' : '') + '<h3>문장 유형과 출처</h3>'+(r.analysis_id?'<p class="trace-note">'+(r.matched_claim_ids?.length?'기사의 핵심 주장 분석을 재사용했습니다.':'선택 문장을 별도로 분석했습니다.')+'</p>':'') + r.claims.map(c => '<p>' + pill(TYPE_LABELS[c.claim_type]) + ' ' + pill(SOURCE_LABELS[c.source_status]) + '</p><blockquote>' + esc(c.original_text) + '</blockquote>').join('') +
    r.sources.map(s => sourceSummary(s,r.is_demo)).join('') + pill(CAUTION_LABELS[r.caution.status],r.caution.status === 'caution') + decisionDetails(r.caution,r.sources,r.is_demo) + errorList(r.pipeline_errors) + '<p class="trace-note">출처 확인 상태이며 사실·거짓 판정이 아닙니다.</p>';
}
