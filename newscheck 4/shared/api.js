import {reportReviewPoints} from './summary.js';
export function backendUrl(value = 'http://127.0.0.1:8000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('올바른 서버 주소를 입력해 주세요.');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('로컬 서버 외에는 HTTPS가 필요합니다.');
  return url.origin;
}
export class ApiError extends Error {
  constructor(message, {code='network_error',status=0,retry_after_seconds=null}={}) { super(message);this.code=code;this.status=status;this.retry_after_seconds=retry_after_seconds; }
}
async function fetchJson(path, options, fetcher) {
  const settings=await chrome.storage.local.get('backendUrl');
  let response;
  try { response=await fetcher(backendUrl(settings.backendUrl)+path,{...options,signal:AbortSignal.timeout(120000)}); }
  catch (error) { throw new ApiError(error.name==='TimeoutError' ? '분석 서버 응답 시간이 초과되었습니다.' : '분석 서버에 연결하지 못했습니다.', {code:error.name==='TimeoutError'?'timeout':'network_error'}); }
  if (response.status===404 && options.method==='GET') return null;
  if (!response.ok) {
    let data={}; try {data=await response.json();} catch {}
    const code=data.error?.code || ({429:'rate_limited',503:'configuration_missing',504:'timeout'}[response.status]) || 'server_error';
    const message=typeof data.detail==='string'?data.detail:'분석 서버 오류 ('+response.status+'). 서버 실행 상태와 설정을 확인해 주세요.';
    throw new ApiError(message,{code,status:response.status,retry_after_seconds:data.error?.retry_after_seconds ?? null});
  }
  try {return await response.json();} catch {throw new ApiError('서버 응답 형식이 올바르지 않습니다.',{code:'invalid_response'});}
}
export async function getAnalysis(articleId, url, fetcher=fetch) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(articleId)) throw new ApiError('분석 ID 형식 오류',{code:'invalid_input'});
  const data=await fetchJson('/api/articles/'+encodeURIComponent(articleId)+'?url='+encodeURIComponent(url),{method:'GET'},fetcher);
  return data===null?null:validateAnalysis(data);
}
export async function requestAnalysis(path, payload, fetcher = fetch) {
  if (!['/api/articles/analyze', '/api/preview', '/api/claims/check','/api/words/explain'].includes(path)) throw new Error('지원하지 않는 요청입니다.');
  const data=await fetchJson(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  if (path === '/api/articles/analyze') validateAnalysis(data);
  if (path === '/api/preview') validatePreview(data);
  if (path === '/api/claims/check') validateSelection(data);
  if (path === '/api/words/explain') validateWord(data);
  return data;
}
const sourceStates = ['original_found', 'secondary_only', 'source_not_found', 'unknown'];
function decision(d) { return d && ['caution', 'none_identified', 'unknown'].includes(d.status) && Array.isArray(d.reasons) && d.reasons.length && d.reasons.every(r => typeof r === 'string' && r.trim()); }
function source(s) { return s && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.title === 'string' && typeof s.summary === 'string' && sourceStates.includes(s.original_status) && decision(s.caution) && s.facts && typeof s.facts === 'object'; }
function envelope(r) { return r && typeof r.article_id === 'string' && typeof r.is_demo === 'boolean'; }
function decisionRefs(d,sourceIds,claimIds) {
  for(const item of d.details||[])if(typeof item.reason!=='string'||!item.reason.trim()||!Array.isArray(item.source_ids)||!Array.isArray(item.claim_ids)||item.source_ids.some(id=>!sourceIds.has(id))||item.claim_ids.some(id=>!claimIds.has(id)))throw new Error('주의사항 참조 오류');
}
function rejectLegacy(obj) {
  const banned = new Set(['verification_status', 'relation_to_claim', 'credibility', 'score', 'probability', 'sensational_score']);
  const scan = value => { if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (banned.has(k)) throw new Error('이전 사실 판정 응답은 지원하지 않습니다.'); scan(v); } };
  scan(obj);
}
function validateRelatedReport(report) {
  if(typeof report.url!=='string'||typeof report.title!=='string')throw new Error('관련 보도 형식 오류');
  if(report.comparison_basis!==undefined&&!['body_excerpt','search_snippet','title_only','unknown'].includes(report.comparison_basis))throw new Error('보도 비교 범위 오류');
  if(report.comparison_status!==undefined&&!['not_compared','compared','insufficient','failed'].includes(report.comparison_status))throw new Error('보도 비교 상태 오류');
  const points=report.comparison_points ?? [];
  if(report.cited_by_article!==undefined && typeof report.cited_by_article!=='boolean')throw new Error('보도 인용 관계 오류');
  if(!Array.isArray(points)||points.length>6)throw new Error('보도 비교 항목 오류');
  if((points.length>0)!==(report.comparison_status==='compared'))throw new Error('보도 비교 상태와 항목 불일치');
  if(points.length&&(!report.id||!['body_excerpt','search_snippet','title_only'].includes(report.comparison_basis)))throw new Error('보도 비교 ID·범위 누락');
  for(const point of points){
    if(!['common','difference'].includes(point.kind)||!['topic','event','actors','time','figures','attribution','focus','context'].includes(point.aspect))throw new Error('보도 비교 유형 오류');
    for(const quote of [point.article_quote,point.related_quote])if(typeof quote!=='string'||Array.from(quote.trim()).length<8||Array.from(quote).length>600)throw new Error('보도 비교 인용 오류');
    const kind=point.review_kind ?? 'none',status=point.review_status ?? 'none';
    if(!['none','claim_conflict','citation_difference'].includes(kind)||!['none','needs_confirmation','paired_excerpt'].includes(status))throw new Error('교차검증 상태 오류');
    if(point.context_anchor!==undefined && (typeof point.context_anchor!=='string'||point.context_anchor.length>120))throw new Error('교차검증 비교 기준 오류');
    if(kind==='none'?status!=='none':!reportReviewPoints(report).includes(point))throw new Error('교차검증 근거 누락');
  }
}
export function validatePreview(p) {
  rejectLegacy(p);
  if (!envelope(p) || typeof p.summary !== 'string' || typeof p.headline_difference !== 'string' || typeof p.one_line_caution !== 'string' || !Array.isArray(p.major_evidence) || !Array.isArray(p.sources)) throw new Error('미리보기 응답 형식 오류');
  for (const s of p.sources) if (!source(s)) throw new Error('미리보기 출처 형식 오류');
  return p;
}
export function validateSelection(r) {
  rejectLegacy(r);
  if (!envelope(r) || typeof r.selected_text !== 'string' || !Array.isArray(r.claims) || !Array.isArray(r.sources) || !decision(r.caution)) throw new Error('선택 문장 응답 형식 오류');
  for (const s of r.sources) if (!source(s)) throw new Error('선택 문장 출처 형식 오류');
  const ids = new Set(r.sources.map(s => s.id));
  for (const c of r.claims) if (!sourceStates.includes(c.source_status) || !decision(c.caution) || !Array.isArray(c.source_ids) || c.source_ids.some(id => !ids.has(id))) throw new Error('선택 문장 출처 참조 오류');
  const claims=new Set(r.claims.map(c=>c.id));
  if(r.context_scope!==undefined && !['article','page_excerpt'].includes(r.context_scope))throw new Error('선택 문맥 범위 오류');
  for(const d of [r.caution,...r.claims.map(c=>c.caution),...r.sources.map(s=>s.caution)])decisionRefs(d,ids,claims);
  return r;
}
export function validateWord(r) {
  rejectLegacy(r);
  if(!r || typeof r.word_id!=='string' || typeof r.selected_text!=='string' || typeof r.is_demo!=='boolean' ||
    !['found','search_only','not_found','failed'].includes(r.dictionary_status) || !Array.isArray(r.dictionary_sources) ||
    !['lemma','general_meaning','dictionary_meaning','contextual_meaning','context_quote'].every(k=>typeof r[k]==='string'))throw new Error('단어 설명 응답 형식 오류');
  if(!['article','page_excerpt'].includes(r.context_scope))throw new Error('단어 문맥 범위 오류');
  if(!['word_id','selected_text','lemma','general_meaning'].every(k=>r[k].trim()))throw new Error('단어 설명 필수 정보 누락');
  for(const s of r.dictionary_sources) {
    let url;try{url=new URL(s.url);}catch{throw new Error('사전 출처 형식 오류');}
    if(url.protocol!=='https:' || url.username || url.password || !['id','title','excerpt'].every(k=>typeof s[k]==='string' && s[k].trim()) || !['retrieved','search_snippet'].includes(s.basis))throw new Error('사전 출처 형식 오류');
  }
  if(['found','search_only'].includes(r.dictionary_status) && (!r.dictionary_sources.length || !r.dictionary_meaning))throw new Error('사전 근거 누락');
  if(r.dictionary_sources.some(s=>s.basis!==(r.dictionary_status==='found'?'retrieved':'search_snippet')))throw new Error('사전 확보 범위 불일치');
  if(['not_found','failed'].includes(r.dictionary_status) && (r.dictionary_sources.length || r.dictionary_meaning))throw new Error('미확인 사전 자료가 포함되었습니다.');
  if(r.contextual_meaning && !r.context_quote.includes(r.selected_text))throw new Error('문맥 인용 오류');
  return r;
}
export function validateAnalysis(a) {
  if (!envelope(a) || a.schema_version !== 'source-tracing-v1' || !a.article || typeof a.one_line_summary !== 'string' || !Array.isArray(a.claims) || !Array.isArray(a.sources) || !Array.isArray(a.evidence_mentions) || !Array.isArray(a.context_timeline) || !Array.isArray(a.related_articles) || !decision(a.caution)) throw new Error('분석 응답 형식이 올바르지 않습니다.');
  const ids = new Set(a.sources.map(s => s.id));
  for(const report of a.related_articles)validateRelatedReport(report);
  for (const s of a.sources) if (!source(s)) throw new Error('출처 응답 형식 오류');
  for (const c of a.claims) if (!sourceStates.includes(c.source_status) || !decision(c.caution) || !Array.isArray(c.source_ids) || c.source_ids.some(id => !ids.has(id))) throw new Error('주장 출처 참조 오류');
  const claims=new Set(a.claims.map(c=>c.id));
  const mentions=new Set(a.evidence_mentions.map(m=>m.id));
  if(a.headline_explanation!==undefined){
    const h=a.headline_explanation;
    if(!h || typeof h.meaning!=='string' || Array.from(h.meaning).length>600 || !Array.isArray(h.reasons) || h.reasons.length>4)throw new Error('제목 설명 형식 오류');
    for(const reason of h.reasons){
      if(typeof reason.text!=='string' || !reason.text.trim() || Array.from(reason.text).length>240 || typeof reason.article_quote!=='string' || !reason.article_quote.trim())throw new Error('제목 이유 형식 오류');
      for(const [key,allowed] of [['claim_ids',claims],['mention_ids',mentions],['source_ids',ids]])if(!Array.isArray(reason[key]) || reason[key].some(id=>!allowed.has(id)))throw new Error('제목 이유 참조 오류');
    }
  }
  for(const item of a.context_timeline){
    if(item.label!==undefined && (typeof item.label!=='string' || Array.from(item.label).length>24))throw new Error('배경 짧은 표현 형식 오류');
    if(item.is_main_event!==undefined && typeof item.is_main_event!=='boolean')throw new Error('주요 사건 표시 형식 오류');
  }
  if(a.context_timeline.filter(t=>t.is_main_event).length>1)throw new Error('주요 사건은 하나만 표시합니다.');
  for(const d of [a.caution,...a.claims.map(c=>c.caution),...a.sources.map(s=>s.caution)])decisionRefs(d,ids,claims);
  rejectLegacy(a);
  return a;
}
