import test from 'node:test';
import assert from 'node:assert/strict';
import { credibility, badgeInfo, CRED_THRESHOLDS } from '../newscheck 4/shared/summary.js';

const NOW = new Date('2026-11-13T00:00:00Z');
const claim = (source_status, cautionStatus = 'none_identified') => ({ source_status, original_text: '정책연구원은 제도 개편을 검토하고 있다고 밝혔다', caution: { status: cautionStatus, reasons: [] } });
const related = (kinds) => ({ comparison_status: 'compared', comparison_points: kinds.map(kind => ({ kind })) });
const base = (extra = {}) => ({
  article: { title: '정책연구원 제도 개편 검토', author: '홍길동', publisher: '테스트일보', published_at: '2026-11-12' },
  one_line_summary: '정책연구원이 제도 개편을 검토하고 있다',
  claims: [claim('original_found'), claim('original_found')],
  evidence_mentions: [], search_status: 'completed', analysis_status: 'complete',
  caution: { status: 'none_identified', reasons: [] },
  related_articles: [related(['common', 'common', 'common']), related(['common', 'difference'])],
  ...extra,
});

test('well-sourced article is high', () => {
  const c = credibility(base(), NOW);
  assert.equal(c.level, 'high');
  assert.ok(c.percent >= CRED_THRESHOLDS.high);
  assert.match(badgeInfo(base(), NOW).label, /^🟢 신뢰 높음 \d+%$/);
});

test('missing sources and old date goes low', () => {
  const a = base({ claims: [claim('source_not_found', 'caution'), claim('source_not_found', 'caution')], article: { title: '충격 폭로 전격 공개', published_at: '2024-01-01' },
    related_articles: [related(['difference', 'difference'])], evidence_mentions: [{ anonymous: true }, { anonymous: true }] });
  const c = credibility(a, NOW);
  assert.equal(c.level, 'low');
});

test('middle case is mid', () => {
  const a = base({ claims: [claim('original_found'), claim('source_not_found', 'caution')], related_articles: [related(['common', 'difference'])] });
  assert.equal(credibility(a, NOW).level, 'mid');
});

test('too little data holds instead of guessing', () => {
  const a = base({ claims: [], related_articles: [], article: { title: '제목', published_at: null } });
  const c = credibility(a, NOW);
  assert.equal(c.level, 'hold');
  assert.equal(c.percent, null);
  assert.match(badgeInfo(a, NOW).label, /^⚪ 판단 보류$/);
});

test('failed search drops the source factor', () => {
  const c = credibility(base({ search_status: 'failed' }), NOW);
  assert.ok(c.unmeasured.includes('출처 확인'));
});

test('loading and error screens produce nothing', () => {
  assert.equal(credibility({ ui_state: 'loading' }, NOW), null);
  assert.equal(badgeInfo({ ui_state: 'error' }, NOW), null);
});

test('attribution differences against the original lower the score more than other differences', () => {
  const pts = (aspect) => ({ comparison_status: 'compared', comparison_points: [{ kind: 'common', aspect: 'topic' }, { kind: 'common', aspect: 'event' }, { kind: 'difference', aspect }] });
  const withAttribution = credibility(base({ related_articles: [pts('attribution')] }), NOW);
  const withFocus = credibility(base({ related_articles: [pts('focus')] }), NOW);
  assert.ok(withAttribution.percent < withFocus.percent);
});
