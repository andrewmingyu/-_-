import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {markHeadline} from '../newscheck 4/lib/extract.js';
import {sourceNotice, badgeInfo} from '../newscheck 4/shared/summary.js';
const decision=(status='none_identified',reasons=[])=>({status,reasons});
function base() {
  return {article:{title:'정책 검토',author:'기자',publisher:'언론사',published_at:'2026-11-12'},
    claims:[{id:'c1',source_status:'original_found',claim_type:'factual_narration',source_ids:['s1'],caution:decision()}],
    evidence_mentions:[{id:'m1',claim_ids:['c1'],anonymous:false}],
    sources:[{id:'s1',mention_ids:['m1'],discovery:'article_cited',original_status:'original_found',content_status:'retrieved',caution:decision()}],
    search_status:'completed',search_errors:[],pipeline_errors:[],analysis_status:'complete',caution:decision(),related_articles:[]};
}
test('completed core source tracing with no issues is clear, without numeric ratings',()=>{
  const a=base(),n=sourceNotice(a),badge=badgeInfo(a);
  assert.equal(n.level,'clear');assert.equal(n.icon,'🟢');
  assert.equal(n.text,'확보한 범위에서 별도 주의사항 없음');
  assert.match(badge.label,/^🟢 확보한 범위/);
  for(const item of [n,badge])for(const field of ['percent','score','factors','weight'])assert.equal(field in item,false);
  assert.doesNotMatch(JSON.stringify(badge),/\d+%|\d+점|신뢰 높음|🔴/);
});
test('publisher identity, article age, wording overlap and comparison counts never change the state',()=>{
  const a=base();
  a.article={title:'전혀 다른 제목',author:null,publisher:null,published_at:'2000-01-01'};
  a.related_articles=Array.from({length:5},()=>({comparison_status:'compared',comparison_points:[{kind:'difference'}]}));
  assert.deepEqual(sourceNotice(a),sourceNotice(base()));
});
test('anonymous attribution is a caution with claim linkage, not a false verdict',()=>{
  const a=base();a.evidence_mentions[0].anonymous=true;
  a.claims[0].caution=decision('caution',['익명 관계자 등의 발언으로 원출처를 추적하기 어렵습니다.']);
  const n=sourceNotice(a);assert.equal(n.level,'caution');assert.equal(n.issues.length,1);
  assert.deepEqual(n.issues[0].claim_ids,['c1']);
  assert.match(badgeInfo(a).lines[0],/익명.*주장 1/);
  assert.doesNotMatch(JSON.stringify(n),/거짓|허위|낮은 언론/);
});
test('failed search stays unknown even with many related articles and named authors',()=>{
  const a=base();a.search_status='failed';a.claims[0].source_status='unknown';
  const n=sourceNotice(a);assert.equal(n.level,'unknown');assert.match(n.incomplete.join(' '),/검색 요청이 실패/);
  assert.equal(n.issues.length,0);
});
test('not-run and successful empty search are distinct states',()=>{
  const a=base();a.claims[0].source_status='source_not_found';a.sources=[];
  assert.equal(sourceNotice(a).level,'caution');
  a.search_status='not_run';assert.equal(sourceNotice(a).level,'unknown');
  assert.equal(sourceNotice(a).issues.length,0);
});
test('secondary material gives a direct-original caution and snippet-only claims cannot turn green',()=>{
  const a=base();a.claims[0].source_status='secondary_only';
  assert.equal(sourceNotice(a).issues[0].code,'secondary');
  a.claims[0].source_status='original_found';a.sources[0].content_status='snippet_only';
  assert.equal(sourceNotice(a).level,'unknown');
});
test('an original source must be linked to the article claim and actually retrieved',()=>{
  for(const change of [a=>a.sources=[],a=>a.sources[0].discovery='external_found',a=>a.sources[0].mention_ids=[]]){
    const a=base();change(a);assert.equal(sourceNotice(a).level,'unknown');
  }
});
test('optional profile fields and a neutral source-age notice do not block otherwise completed tracing',()=>{
  const a=base();a.analysis_status='partial';
  a.caution=decision('unknown',['출처 속성을 확인하지 못했습니다: 작성자, 전문 분야, 자료 독립성']);
  a.sources[0].caution=decision('caution',['자료 발행일은 기사 작성일보다 800일 이전입니다. 최신 자료가 필요한지는 별도로 확인해 주세요.']);
  assert.equal(sourceNotice(a).level,'clear');
  assert.equal(sourceNotice(a).issues.length,0);
});
test('a known issue remains visible alongside an incomplete source investigation',()=>{
  const a=base();a.search_status='failed';a.claims[0].source_status='unknown';a.evidence_mentions[0].anonymous=true;
  const n=sourceNotice(a);assert.equal(n.level,'caution');assert.equal(n.partial,true);
  assert.match(badgeInfo(a).note,/検索|검색/);assert.match(badgeInfo(a).label,/🟡 주의 필요/);
});
test('source investigation failures block clear while optional related-report failures do not',()=>{
  const a=base();a.pipeline_errors=[{phase:'source_review',message:'출처 정리 실패'}];
  assert.equal(sourceNotice(a).level,'unknown');
  a.pipeline_errors=[{phase:'related_comparison',message:'다른 보도 비교 실패'}];
  a.search_errors=['다른 보도와의 비교를 완료하지 못했습니다. 관련 기사 목록은 유지합니다.'];
  assert.equal(sourceNotice(a).level,'clear');
});
test('unexplained unknown decisions remain unknown rather than claiming no issues',()=>{
  const a=base();a.caution=decision('unknown',['자료 관계를 정리할 정보가 부족합니다.']);
  assert.equal(sourceNotice(a).level,'unknown');
});
test('objective reasons are merged with their references and badge output is limited to three',()=>{
  const a=base();a.claims.push({...a.claims[0],id:'c2'});
  a.caution={status:'caution',reasons:['익명 관계자 등의 발언으로 원출처를 추적하기 어렵습니다.','추가 자료 확인 필요','통계 범위 확인 필요','발언 시점 확인 필요'],
    details:[{reason:'익명 관계자 등의 발언으로 원출처를 추적하기 어렵습니다.',claim_ids:['c2'],source_ids:['s1']}]};
  a.evidence_mentions[0].anonymous=true;
  const n=sourceNotice(a);assert.equal(n.issues.length,4);
  assert.deepEqual(new Set(n.issues[0].claim_ids),new Set(['c1','c2']));
  assert.deepEqual(n.issues[0].source_ids,['s1']);assert.equal(badgeInfo(a).lines.length,3);
});
test('empty, loading and error inputs cannot receive a positive state',()=>{
  assert.equal(sourceNotice({...base(),claims:[]}).level,'unknown');
  assert.equal(sourceNotice(null),null);assert.equal(sourceNotice({ui_state:'loading'}),null);
  assert.equal(badgeInfo({ui_state:'error'}),null);
});
test('mock badges explicitly identify demo data even before their popup is opened',()=>{
  const a=base();a.is_demo=true;
  assert.match(badgeInfo(a).label,/시연용/);
  assert.match(badgeInfo(a).note,/실제 분석 결과가 아닙니다/);
});
test('external discovery without article attribution cannot introduce a source-only caution',()=>{
  const a=base();a.sources.push({id:'external',discovery:'external_found',caution:decision('caution',['외부 자료의 작성자 확인 필요'])});
  a.caution={status:'caution',reasons:['외부 자료의 작성자 확인 필요'],details:[{reason:'외부 자료의 작성자 확인 필요',source_ids:['external'],claim_ids:[]}]};
  assert.equal(sourceNotice(a).level,'clear');
  a.caution.status='unknown';assert.equal(sourceNotice(a).level,'clear');
});
test('actual article badge uses the same state text and cautions, without score markup',()=>{
  const previous=globalThis.document;
  try {
    globalThis.document=new JSDOM('<h1>정책 검토</h1>').window.document;
    const a=base();a.evidence_mentions[0].anonymous=true;
    const info=badgeInfo(a);assert.equal(markHeadline(a.article.title,info),true);
    const shadow=document.querySelector('#newscheck-badge-host').shadowRoot;
    assert.equal(shadow.querySelector('.chip').textContent,info.label);
    assert.equal(shadow.querySelector('.chip').classList.contains('lvl-caution'),true);
    shadow.querySelector('.chip').click();assert.equal(shadow.querySelector('.pop').hidden,false);
    assert.ok(shadow.querySelector('.pop').textContent.includes(info.lines[0]));
    assert.doesNotMatch(shadow.querySelector('.chip').textContent+shadow.querySelector('.pop').textContent,/\d+점|\d+%|신뢰 높음|🔴/);
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('a found original candidate is shown as a short candidate line, not as missing',()=>{
  const a=base();a.claims[0].source_status='source_not_found';a.search_status='completed';
  assert.match(sourceNotice(a).issues.find(i=>i.code==='not_found').text,/원자료를 찾지 못했습니다/);
  a.related_articles=[{id:'report_bbc',url:'https://www.bbc.com/news/x',title:'Nvidia board probe',publisher:'BBC',original_candidate:true,comparison_status:'compared',comparison_basis:'body_excerpt',comparison_points:[]}];
  const item=sourceNotice(a).issues.find(i=>i.code==='not_found');
  assert.equal(item.text,'원문 후보: BBC「Nvidia board probe」');
  assert.equal(item.candidate_id,'report_bbc');
  assert.deepEqual(item.report_ids,['report_bbc']);
});
