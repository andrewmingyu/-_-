export function backendUrl(value = 'http://127.0.0.1:8000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('올바른 서버 주소를 입력해 주세요.');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('로컬 서버 외에는 HTTPS가 필요합니다.');
  return url.origin;
}
export async function requestAnalysis(path, payload, fetcher = fetch) {
  if (!['/api/articles/analyze', '/api/preview', '/api/claims/check'].includes(path)) throw new Error('지원하지 않는 요청입니다.');
  const settings = await chrome.storage.local.get('backendUrl');
  const base = backendUrl(settings.backendUrl);
  const response = await fetcher(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('분석 서버 오류 (' + response.status + '). 서버 실행 상태와 설정을 확인해 주세요.');
  const data = await response.json();
  if (path === '/api/articles/analyze') validateAnalysis(data);
  if (path === '/api/preview') validatePreview(data);
  if (path === '/api/claims/check') validateSelection(data);
  return data;
}
const sourceStates = ['original_found', 'secondary_only', 'source_not_found', 'unknown'];
function decision(d) { return d && ['caution', 'none_identified', 'unknown'].includes(d.status) && Array.isArray(d.reasons) && d.reasons.length && d.reasons.every(r => typeof r === 'string' && r.trim()); }
function source(s) { return s && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.title === 'string' && typeof s.summary === 'string' && sourceStates.includes(s.original_status) && decision(s.caution) && s.facts && typeof s.facts === 'object'; }
function envelope(r) { return r && typeof r.article_id === 'string' && typeof r.is_demo === 'boolean'; }
function rejectLegacy(obj) {
  const banned = new Set(['verification_status', 'relation_to_claim', 'credibility', 'score', 'probability', 'sensational_score']);
  const scan = value => { if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (banned.has(k)) throw new Error('이전 사실 판정 응답은 지원하지 않습니다.'); scan(v); } };
  scan(obj);
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
  return r;
}
export function validateAnalysis(a) {
  if (!envelope(a) || a.schema_version !== 'source-tracing-v1' || !a.article || typeof a.one_line_summary !== 'string' || !Array.isArray(a.claims) || !Array.isArray(a.sources) || !Array.isArray(a.evidence_mentions) || !Array.isArray(a.context_timeline) || !Array.isArray(a.related_articles) || !decision(a.caution)) throw new Error('분석 응답 형식이 올바르지 않습니다.');
  const ids = new Set(a.sources.map(s => s.id));
  for (const s of a.sources) if (!source(s)) throw new Error('출처 응답 형식 오류');
  for (const c of a.claims) if (!sourceStates.includes(c.source_status) || !decision(c.caution) || !Array.isArray(c.source_ids) || c.source_ids.some(id => !ids.has(id))) throw new Error('주장 출처 참조 오류');
  rejectLegacy(a);
  return a;
}
