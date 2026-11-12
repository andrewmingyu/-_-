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
  if (!['/api/articles/analyze', '/api/preview', '/api/claims/check'].includes(path)) throw new Error('지원하지 않는 요청입니다.');
  const data=await fetchJson(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  if (path === '/api/articles/analyze') validateAnalysis(data);
  if (path === '/api/preview') validatePreview(data);
  if (path === '/api/claims/check') validateSelection(data);
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
  if(!Array.isArray(points)||points.length>6)throw new Error('보도 비교 항목 오류');
  if((points.length>0)!==(report.comparison_status==='compared'))throw new Error('보도 비교 상태와 항목 불일치');
  if(points.length&&(!report.id||!['body_excerpt','search_snippet','title_only'].includes(report.comparison_basis)))throw new Error('보도 비교 ID·범위 누락');
  for(const point of points){
    if(!['common','difference'].includes(point.kind)||!['topic','event','actors','time','figures','attribution','focus','context'].includes(point.aspect))throw new Error('보도 비교 유형 오류');
    for(const quote of [point.article_quote,point.related_quote])if(typeof quote!=='string'||Array.from(quote.trim()).length<8||Array.from(quote).length>600)throw new Error('보도 비교 인용 오류');
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
  for(const d of [r.caution,...r.claims.map(c=>c.caution),...r.sources.map(s=>s.caution)])decisionRefs(d,ids,claims);
  return r;
}
export function validateAnalysis(a) {
  if (!envelope(a) || a.schema_version !== 'source-tracing-v1' || !a.article || typeof a.one_line_summary !== 'string' || !Array.isArray(a.claims) || !Array.isArray(a.sources) || !Array.isArray(a.evidence_mentions) || !Array.isArray(a.context_timeline) || !Array.isArray(a.related_articles) || !decision(a.caution)) throw new Error('분석 응답 형식이 올바르지 않습니다.');
  const ids = new Set(a.sources.map(s => s.id));
  for(const report of a.related_articles)validateRelatedReport(report);
  for (const s of a.sources) if (!source(s)) throw new Error('출처 응답 형식 오류');
  for (const c of a.claims) if (!sourceStates.includes(c.source_status) || !decision(c.caution) || !Array.isArray(c.source_ids) || c.source_ids.some(id => !ids.has(id))) throw new Error('주장 출처 참조 오류');
  const claims=new Set(a.claims.map(c=>c.id));
  for(const d of [a.caution,...a.claims.map(c=>c.caution),...a.sources.map(s=>s.caution)])decisionRefs(d,ids,claims);
  rejectLegacy(a);
  return a;
}
