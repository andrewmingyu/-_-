import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {sourceNotice,badgeInfo} from '../newscheck 4/shared/summary.js';
import {renderAnalysis} from '../newscheck 4/shared/view.js';
import {validateAnalysis} from '../newscheck 4/shared/api.js';
import {markHeadline} from '../newscheck 4/lib/extract.js';
const fixture=JSON.parse(fs.readFileSync('newscheck 4/data/demo.json','utf8'));
const current='2027년 지원금은 올해보다 확대할 계획이라고 발표했다.';
const other='2027년 지원금은 올해보다 축소할 계획이라고 발표했다.';
function example(){
  const a=structuredClone(fixture),r=a.related_articles[0];
  Object.assign(r,{title:'지원 규모를 다룬 다른 시연 보도',comparison_status:'compared',comparison_basis:'body_excerpt',cited_by_article:false,
    comparison_points:[{kind:'difference',aspect:'figures',article_quote:current,related_quote:other,
      review_kind:'claim_conflict',context_anchor:'2027년 지원금',review_status:'paired_excerpt'}]});
  return a;
}
test('validated report conflicts take red attention priority without any truth score',()=>{
  const a=example(),notice=sourceNotice(a);assert.equal(validateAnalysis(a),a);
  assert.equal(notice.level,'review');assert.equal(notice.icon,'🔴');
  assert.ok(notice.issues[0].text.includes(a.related_articles[0].title));
  assert.deepEqual(notice.issues[0].report_ids,[a.related_articles[0].id]);
  assert.match(badgeInfo(a).label,/🔴 교차검증 필요/);
  assert.doesNotMatch(JSON.stringify(notice),/\d+점|\d+%|왜곡했습니다|거짓 기사/);
});
test('red notice opens the exact related report and preserves the other open cards',()=>{
  const a=example(),document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,a,new Set(['claims']));
  root.querySelector('.notice-card [data-report-review]').click();
  const report=document.getElementById('related-report-'+a.related_articles[0].id);
  assert.equal(report.open,true);assert.equal(root.querySelector('#details-related').hidden,false);
  assert.equal(root.querySelector('#details-claims').hidden,false);
  assert.ok(report.textContent.includes(current)&&report.textContent.includes(other));
  assert.ok(report.querySelector('.report-review'));assert.equal(root.querySelectorAll('[data-toggle]').length,6);
});
test('unconfirmed comparison material stays yellow and cannot masquerade as red',()=>{
  const a=example(),r=a.related_articles[0];
  r.comparison_basis='search_snippet';r.comparison_points[0].review_status='needs_confirmation';
  assert.equal(validateAnalysis(a),a);assert.equal(sourceNotice(a).level,'caution');
  r.comparison_points[0].review_status='paired_excerpt';assert.throws(()=>validateAnalysis(a),/교차검증 근거/);
  assert.notEqual(sourceNotice(a).level,'review');
});
test('citation wording is flagged only with a verified relation, and distortion is never asserted',()=>{
  const a=example(),r=a.related_articles[0];r.comparison_points[0].review_kind='citation_difference';
  assert.throws(()=>validateAnalysis(a),/교차검증 근거/);
  assert.notEqual(sourceNotice(a).level,'review');
  r.cited_by_article=true;assert.equal(validateAnalysis(a),a);
  assert.match(sourceNotice(a).issues[0].text,/왜곡 여부/);
  const document=new JSDOM('<main></main>').window.document;
  renderAnalysis(document.querySelector('main'),a,new Set(['related']));
  assert.doesNotMatch(document.body.textContent,/왜곡했습니다/);
});
test('ordinary focus differences and missing literal context do not create red warnings',()=>{
  const a=example(),r=a.related_articles[0],p=r.comparison_points[0];
  p.aspect='focus';p.review_kind='none';p.review_status='none';
  assert.equal(validateAnalysis(a),a);assert.notEqual(sourceNotice(a).level,'review');
  p.aspect='figures';p.review_kind='claim_conflict';p.review_status='paired_excerpt';p.context_anchor='없는 기준';
  assert.throws(()=>validateAnalysis(a),/교차검증 근거/);assert.notEqual(sourceNotice(a).level,'review');
});
test('red article badges use the cross-check label and identical quotes cannot become a conflict',()=>{
  const a=example(),previous=globalThis.document;
  try {
    globalThis.document=new JSDOM('<h1>지원금 비교 시연 기사</h1>').window.document;
    a.article.title='지원금 비교 시연 기사';markHeadline(a.article.title,badgeInfo(a));
    const chip=document.getElementById('newscheck-badge-host').shadowRoot.querySelector('.chip');
    assert.equal(chip.classList.contains('lvl-review'),true);assert.match(chip.textContent,/🔴 교차검증 필요/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
  a.related_articles[0].comparison_points[0].related_quote=current;
  assert.notEqual(sourceNotice(a).level,'review');
});
test('merged top comparison keeps candidate disclosure, translation, red alert and exact report navigation',()=>{
  const a=example(),r=a.related_articles[0],p=r.comparison_points[0];
  r.original_candidate=true;p.related_quote_ko='비교 자료의 한국어 번역';p.explanation='두 자료의 지원 규모 표현이 다름';
  assert.equal(validateAnalysis(a),a);
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,a,new Set(['claims']));
  const card=root.querySelector('.odiff');assert.ok(card);
  assert.match(card.textContent,/원문 후보 · 인용 관계 미확인/);
  assert.match(card.textContent,/AI 한국어 번역/);assert.ok(card.textContent.includes(p.explanation));
  assert.ok(card.querySelector('.report-review'));assert.equal(root.querySelectorAll('[data-toggle]').length,6);
  card.querySelector('[data-report-review]').click();
  assert.equal(document.getElementById('related-report-'+r.id).open,true);
  assert.equal(root.querySelector('#details-claims').hidden,false);
  assert.ok(root.querySelector('#details-related').textContent.includes(p.related_quote_ko));
  p.review_kind='citation_difference';assert.throws(()=>validateAnalysis(a),/교차검증 근거/);
});
