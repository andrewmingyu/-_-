// 출처 추적 현황 요약.
// 기사 내용의 사실·거짓이나 신뢰도를 판정하지 않고, 서버가 돌려준 "출처 확인 상태"만 센다.
const STATUS_LABELS = {
  original_found: '원본 자료 확인',
  secondary_only: '재인용만 확인',
  source_not_found: '원출처 못 찾음',
  unknown: '정보 부족',
};
export const TRACE_NOTE = '출처를 찾았는지 보여 주는 표시예요. 원본 자료가 있어도 기사 내용이 맞다는 뜻은 아니고, 사실 여부는 판정하지 않아요.';

export function traceSummary(a) {
  if (!a || a.ui_state) return null; // 분석 중·오류 화면에서는 표시하지 않는다
  const claims = Array.isArray(a.claims) ? a.claims : [];
  const claimStatuses = claims.map(c => (c.source_status in STATUS_LABELS ? c.source_status : 'unknown'));
  const count = key => claimStatuses.filter(s => s === key).length;
  const total = claimStatuses.length;
  const found = count('original_found');

  let headline;
  if (!total) headline = '기사에서 출처를 추적할 주장을 찾지 못했어요';
  else if (found === total) headline = '주장 ' + total + '개 모두 원본 자료를 찾았어요';
  else if (found > 0) headline = '주장 ' + total + '개 중 ' + found + '개의 원본 자료를 찾았어요';
  else if (count('secondary_only') > 0) headline = '원본은 못 찾고 재인용 자료만 확인했어요';
  else if (count('source_not_found') > 0) headline = '원출처를 찾지 못했어요';
  else headline = '출처를 확인할 정보가 부족해요';

  const cautionCount = a.caution?.status === 'caution' ? (a.caution.reasons?.length || 0) : 0;
  return {
    headline,
    total,
    cells: claimStatuses.map(key => ({ key, label: STATUS_LABELS[key] })),
    legend: Object.keys(STATUS_LABELS).filter(key => count(key) > 0).map(key => ({ key, label: STATUS_LABELS[key], count: count(key) })),
    caution: a.caution?.status === 'caution',
    cautionCount,
    partial: a.analysis_status === 'partial' || a.search_status === 'failed',
  };
}

// 기사 제목 옆 배지용 요약 (표시 문구만 담는 단순 객체)
// ───────── 종합 신뢰 지수 (참고용) ─────────
// 서버가 돌려준 분석 결과를 규칙으로 계산한다. AI가 기사의 참·거짓을 판단한 값이 아니다.
export const CRED_NOTE = '참고용 추정 점수예요. 출처·다른 보도 비교·날짜·제목 일치를 규칙으로 계산한 값이며, 기사 내용의 사실 여부를 판정한 것이 아니에요.';
export const CRED_LEVELS = {
  high: { icon: '🟢', text: '신뢰 높음', hint: '확인된 출처와 다른 보도 근거가 비교적 충분해요' },
  mid: { icon: '🟡', text: '주의 필요', hint: '추가로 확인할 부분이 남아 있어요' },
  low: { icon: '🔴', text: '주의 요망', hint: '출처가 불분명하거나 확인되지 않은 부분이 많아요' },
  hold: { icon: '⚪', text: '판단 보류', hint: '점수를 낼 만큼 정보가 모이지 않았어요' },
};
export const CRED_THRESHOLDS = { high: 70, mid: 40 };
const WEIGHTS = { cross: 30, source: 30, verify: 15, title: 15, date: 10 };
const FACTOR_LABELS = { cross: '교차검증', source: '출처 확인', verify: '추가 검증 필요 주장', title: '제목·본문 일치', date: '날짜' };
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
const mean = list => list.reduce((x, y) => x + y, 0) / list.length;
const bigrams = text => {
  const n = String(text || '').replace(/[^0-9A-Za-z가-힣]/g, '');
  const set = new Set();
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2));
  return set;
};

function crossFactor(a) {
  const compared = (a.related_articles || []).filter(r => r.comparison_status === 'compared');
  if (!compared.length) return null;
  let common = 0; let diff = 0; let weighted = 0;
  // '누가 말했는가'(귀속) 차이는 의미를 바꾸기 쉬워 3배로 센다. 가중치는 초기값이다.
  compared.forEach(r => (r.comparison_points || []).forEach(p => {
    if (p.kind === 'common') common++; else { diff++; weighted += p.aspect === 'attribution' ? 3 : 1; }
  }));
  const ratio = common + weighted ? common / (common + weighted) : 0;
  const coverage = Math.min(1, compared.length / 2);
  return { score: clamp(100 * (0.7 * ratio + 0.3 * coverage)), detail: '비교한 보도 ' + compared.length + '건 · 공통 ' + common + ' · 차이 ' + diff };
}

function sourceFactor(a) {
  const claims = a.claims || [];
  if (!claims.length || a.search_status === 'failed') return null;
  const weight = { original_found: 1, secondary_only: 0.5, unknown: 0.25, source_not_found: 0 };
  const found = claims.filter(c => c.source_status === 'original_found').length;
  const avg = mean(claims.map(c => weight[c.source_status] ?? 0.25));
  const author = !!a.article?.author; const publisher = !!a.article?.publisher;
  const anonymous = (a.evidence_mentions || []).filter(m => m.anonymous).length;
  const score = clamp(70 * avg + (author ? 15 : 0) + (publisher ? 15 : 0) - Math.min(15, anonymous * 5));
  return { score, detail: '원본 확인 ' + found + '/' + claims.length + ' · 작성자 ' + (author ? '표기' : '미확인') + ' · 언론사 ' + (publisher ? '표기' : '미확인') + (anonymous ? ' · 익명 인용 ' + anonymous : '') };
}

function dateFactor(a, now) {
  const raw = a.article?.published_at;
  const time = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(time)) return null;
  const age = Math.max(0, Math.floor((now.getTime() - time) / 86400000));
  const score = age <= 2 ? 100 : age <= 30 ? 80 : age <= 365 ? 50 : 25;
  return { score, detail: '작성일 ' + new Date(time).toISOString().slice(0, 10) + ' (' + age + '일 전)' };
}

function titleFactor(a) {
  const title = a.article?.title || '';
  const text = [a.one_line_summary, ...(a.claims || []).map(c => c.original_text)].join(' ');
  const grams = bigrams(title);
  if (grams.size < 4 || !text.trim()) return null;
  const target = bigrams(text);
  let hit = 0; grams.forEach(g => { if (target.has(g)) hit++; });
  const overlap = hit / grams.size;
  return { score: clamp(20 + (Math.min(Math.max(overlap, 0.1), 0.5) - 0.1) / 0.4 * 80), detail: '제목 표현이 본문 요약에 담긴 정도 ' + Math.round(overlap * 100) + '%' };
}

function verifyFactor(a) {
  const claims = a.claims || [];
  if (!claims.length) return null;
  const weight = { none_identified: 1, unknown: 0.5, caution: 0 };
  const need = claims.filter(c => c.caution?.status !== 'none_identified').length;
  return { score: clamp(100 * mean(claims.map(c => weight[c.caution?.status] ?? 0.5))), detail: '추가 확인이 필요한 주장 ' + need + '/' + claims.length };
}

export function credibility(a, now = new Date()) {
  if (!a || a.ui_state) return null;
  const parts = { cross: crossFactor(a), source: sourceFactor(a), verify: verifyFactor(a), title: titleFactor(a), date: dateFactor(a, now) };
  const factors = Object.keys(parts).filter(k => parts[k]).map(k => ({ key: k, label: FACTOR_LABELS[k], weight: WEIGHTS[k], ...parts[k] }));
  const unmeasured = Object.keys(parts).filter(k => !parts[k]).map(k => FACTOR_LABELS[k]);
  const weightSum = factors.reduce((x, f) => x + f.weight, 0);
  // 주장을 하나도 추적하지 못했거나 계산에 쓸 정보가 절반 미만이면 점수를 내지 않는다.
  const enough = (a.claims || []).length > 0 && weightSum >= 50;
  const percent = enough ? Math.round(factors.reduce((x, f) => x + f.weight * f.score, 0) / weightSum) : null;
  const level = percent === null ? 'hold' : percent >= CRED_THRESHOLDS.high ? 'high' : percent >= CRED_THRESHOLDS.mid ? 'mid' : 'low';
  return { level, percent, factors, unmeasured, ...CRED_LEVELS[level] };
}

// 기사 제목 옆 배지용 요약 (표시 문구만 담는 단순 객체)
export function badgeInfo(a, now = new Date()) {
  const t = traceSummary(a);
  const c = credibility(a, now);
  if (!t || !c) return null;
  const lines = c.factors.map(f => f.label + ' ' + f.score + '점 · ' + f.detail);
  if (c.unmeasured.length) lines.push('계산에서 제외: ' + c.unmeasured.join(', '));
  lines.push('사진 자료의 날짜는 읽지 못해 반영하지 않았어요');
  return {
    level: c.level,
    percent: c.percent,
    label: c.icon + ' ' + c.text + (c.percent === null ? '' : ' ' + c.percent + '%'),
    caution: '',
    headline: c.hint,
    lines,
    partial: t.partial,
    note: CRED_NOTE,
  };
}