import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderAnalysis, renderAnalysisState, renderPreview, renderSelection, safeLink } from '../newscheck 4/shared/view.js';
import { validateAnalysis, validateSelection, validatePreview, requestAnalysis, backendUrl } from '../newscheck 4/shared/api.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../newscheck 4/data/demo.json',import.meta.url),'utf8'));
test('six independent accessible controls keep all other cards open and survive refresh',()=>{
  const document=new JSDOM('<main></main>').window.document;
  const root=document.querySelector('main'), expanded=new Set();
  renderAnalysis(root,fixture,expanded);
  const buttons=[...root.querySelectorAll('[data-toggle]')];
  assert.equal(buttons.length,6);
  for(const button of buttons) {
    assert.equal(button.tagName,'BUTTON');
    assert.equal(button.getAttribute('aria-expanded'),'false');
    button.click();
    assert.equal(button.getAttribute('aria-expanded'),'true');
    assert.equal(document.getElementById(button.getAttribute('aria-controls')).hidden,false);
  }
  assert.equal(expanded.size,6);
  buttons[2].click();
  assert.equal(expanded.size,5);
  assert.equal(buttons[0].getAttribute('aria-expanded'),'true');
  renderAnalysis(root,fixture,expanded);
  assert.equal(root.querySelectorAll('[data-toggle][aria-expanded="true"]').length,5);
});
test('all displays use source states and a visible demo label, never a truth score',()=>{
  const document=new JSDOM('<main></main>').window.document;
  renderAnalysis(document.querySelector('main'),fixture);
  const html=document.body.innerHTML;
  assert.match(html,/시연용 예시/);
  assert.match(html,/원본 자료 확인/);
  assert.doesNotMatch(html,/신뢰도|다른 보도와 일치|거짓 또는 오류|확인된 사실|\d+%/);
  const preview=renderPreview({is_demo:true,summary:fixture.one_line_summary,major_evidence:fixture.evidence_mentions,sources:fixture.sources,headline_difference:fixture.headline_difference,one_line_caution:fixture.caution.reasons[0]});
  const selection=renderSelection({is_demo:true,claims:fixture.claims,sources:fixture.sources,caution:fixture.caution});
  for(const rendered of [preview,selection]) {
    assert.match(rendered,/시연용 예시/);
    assert.doesNotMatch(rendered,/신뢰도|반박됨|일부 확인|거짓 또는 오류/);
  }
});
test('untrusted article text and URL schemes cannot create executable markup',()=>{
  const document=new JSDOM('<main></main>').window.document;
  const a=structuredClone(fixture);a.one_line_summary='<img src=x onerror=alert(1)>';
  a.sources[0].title='<script>alert(1)</script>';a.sources[0].url='javascript:alert(1)';a.is_demo=false;
  renderAnalysis(document.querySelector('main'),a);
  assert.equal(document.querySelector('script,img'),null);
  assert.equal(document.querySelector('a[href^="javascript:"]'),null);
  assert.equal(safeLink('data:text/html,evil','evil'),'evil');
});
test('contract rejects old fields, broken references and missing objective reasons',()=>{
  assert.equal(validateAnalysis(fixture),fixture);
  for(const mutate of [a=>a.claims[0].verification_status='supports',a=>a.claims[0].source_ids=['invented'],a=>a.caution.reasons=[],a=>a.sources[0].original_status='contradicts']) {
    const a=structuredClone(fixture);mutate(a);assert.throws(()=>validateAnalysis(a));
  }
});
test('related news is diversified by publisher and demo URLs are not clickable',()=>{
  const document=new JSDOM('<main></main>').window.document;
  const a=structuredClone(fixture);a.related_articles.push({...a.related_articles[0],title:'duplicate'});
  renderAnalysis(document.querySelector('main'),a);
  assert.equal(document.querySelectorAll('#summary-related .related-row').length,fixture.related_articles.length);
  assert.equal(document.querySelectorAll('a').length,0);
});
test('report comparisons show scope and paired excerpts without changing the six-card controls',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  const data=structuredClone(fixture),report=data.related_articles[0];
  report.comparison_points[0].related_quote='<script>alert("unsafe")</script>를 인용한 보도';
  renderAnalysis(root,data,new Set(['related','claims']));
  const card=root.querySelector('[data-section="related"]');
  assert.match(card.textContent,/검색 요약 범위 비교/);
  assert.match(card.textContent,/공통으로 다룬 내용/);
  assert.match(card.textContent,/표현·강조가 다른 부분/);
  assert.match(card.textContent,/현재 기사/);assert.match(card.textContent,/비교 보도/);
  assert.match(card.textContent,/공통 보도는 사실 확인을 뜻하지/);
  assert.equal(card.querySelectorAll('script').length,0);
  assert.equal(root.querySelectorAll('[data-toggle]').length,6);
  card.querySelector('[data-toggle]').click();
  assert.equal(root.querySelector('[data-toggle="claims"]').getAttribute('aria-expanded'),'true');
  assert.equal(root.querySelector('#details-related').hidden,true);
});
test('comparison failure and insufficient data keep links and cannot become truth verdicts',()=>{
  for(const status of ['failed','insufficient']){
    const document=new JSDOM('<main></main>').window.document,data=structuredClone(fixture);
    Object.assign(data.related_articles[0],{comparison_status:status,comparison_points:[]});
    validateAnalysis(data);renderAnalysis(document.querySelector('main'),data,new Set(['related']));
    assert.match(document.querySelector('#details-related').textContent,status==='failed'?/보도 비교를 완료하지 못했습니다/:/비교할 구절을 확인하지 못했습니다/);
    assert.match(document.querySelector('#details-related').textContent,/가상방송/);
  }
  for(const mutate of [r=>r.comparison_points[0].kind='supports',r=>r.comparison_basis='full_verified_text',r=>r.comparison_points[0].related_quote='',r=>r.comparison_points=[]]){
    const data=structuredClone(fixture);mutate(data.related_articles[0]);assert.throws(()=>validateAnalysis(data));
  }
});
test('backend URL accepts local HTTP or HTTPS and rejects credentials/non-HTTP',()=>{
  assert.equal(backendUrl(),'http://127.0.0.1:8000');
  assert.equal(backendUrl('https://newscheck.example'),'https://newscheck.example');
  for(const url of ['http://remote.example','file:///secret','https://user:pass@example.com','https://example.com/path']) assert.throws(()=>backendUrl(url));
});
test('summary uses up to two sentence bullets and metadata appears once beside it',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  data.one_line_summary='지원 규모는 3.1조 원이다.\n시행은 검토 중이다.\n세 번째 줄은 표시하지 않는다.';
  renderAnalysis(root,data);
  assert.equal(root.querySelectorAll('.summary-list li').length,2);
  assert.equal(root.querySelector('.summary-list li').textContent,'지원 규모는 3.1조 원이다.');
  assert.equal(root.querySelectorAll('.overview-grid > [data-section="metadata"]').length,1);
  assert.equal(root.querySelectorAll('.analysis-grid [data-section="metadata"]').length,0);
  assert.equal(root.querySelectorAll('[data-toggle]').length,6);
  data.one_line_summary='지원 규모는 3.1조 원이다. 시행은 검토 중이다.';
  renderAnalysis(root,data);
  assert.equal(root.querySelectorAll('.summary-list li').length,2);
  assert.ok(root.querySelector('.summary-list li').textContent.includes('3.1조'));
});
test('background renders short boxes and arrows, with a single real-event fallback',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  renderAnalysis(root,data);
  assert.equal(root.querySelectorAll('#summary-context .context-step').length,2);
  assert.equal(root.querySelectorAll('#summary-context .context-arrow').length,1);
  data.context_timeline=[];
  data.event={description:'기사에서 확인한 핵심 사건을 보여주는 문장입니다.',article_quote:'기사에서 확인한 핵심 사건을 보여주는 문장입니다.',time:null,location:null};
  renderAnalysis(root,data);
  assert.equal(root.querySelectorAll('#summary-context .context-step').length,1);
  assert.equal(root.querySelectorAll('#summary-context .context-arrow').length,0);
  data.event={};renderAnalysis(root,data);
  assert.equal(root.querySelectorAll('.context-step').length,0);
  assert.match(root.querySelector('#summary-context').textContent,/배경 정보가 없습니다/);
});
test('related article titles and publishers stay in compact rows and comparisons start collapsed',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,fixture,new Set(['related']));
  assert.equal(root.querySelectorAll('#summary-related .related-row').length,fixture.related_articles.length);
  assert.equal(root.querySelectorAll('#summary-related .report-comparison').length,0);
  assert.equal(root.querySelectorAll('#details-related .report-detail[open]').length,0);
  assert.equal(root.querySelectorAll('#details-related .report-detail > summary').length,fixture.related_articles.length);
  const row=root.querySelector('#summary-related .related-row');
  assert.ok(row.querySelector('.related-title').textContent.includes(fixture.related_articles[0].title));
  assert.equal(row.querySelector('.related-press').textContent,fixture.related_articles[0].publisher);
});
test('six cards display loading, errors and retry while preserving page metadata',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysisState(root,fixture.article,'loading','분석 대기');
  assert.equal(root.querySelectorAll('[data-toggle]').length,6);
  assert.equal([...root.querySelectorAll('.section-state')].filter(e=>e.textContent.includes('분석 중')).length,5);
  renderAnalysisState(root,fixture.article,'error','서버 오류 <script>');
  assert.equal(root.querySelectorAll('[data-retry]').length,1);
  assert.equal([...root.querySelectorAll('.section-state')].filter(e=>e.textContent.includes('처리 실패')).length,5);
  assert.equal(root.querySelector('script'),null);
  assert.ok(root.textContent.includes(fixture.article.publisher));
});
test('objective caution reasons retain source connections and unknown references are rejected',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  const a=structuredClone(fixture);
  a.caution.details=[{reason:'작성 기관의 이해관계 관련 문구 확인',source_ids:[a.sources[0].id],claim_ids:[a.claims[0].id]}];
  renderAnalysis(root,a);root.querySelector('[data-toggle="cautions"]').click();
  assert.ok(root.querySelector('#details-cautions').textContent.includes(a.sources[0].title));
  assert.equal(validateAnalysis(a),a);
  a.caution.details[0].source_ids=['invented'];assert.throws(()=>validateAnalysis(a),/참조/);
});
test('all API surfaces reject missing demo markers and malformed source states',()=>{
  const preview={article_id:fixture.article_id,is_demo:true,summary:fixture.one_line_summary,major_evidence:fixture.evidence_mentions,sources:fixture.sources,headline_difference:fixture.headline_difference,one_line_caution:'출처 확인 필요'};
  const selection={article_id:fixture.article_id,selected_text:'문장',is_demo:true,claims:fixture.claims,sources:fixture.sources,caution:fixture.caution};
  for(const [payload,validate] of [[fixture,validateAnalysis],[preview,validatePreview],[selection,validateSelection]]){
    assert.equal(validate(payload),payload);
    const missing=structuredClone(payload);delete missing.is_demo;assert.throws(()=>validate(missing));
    const malformed=structuredClone(payload);malformed.sources[0].original_status='verified';assert.throws(()=>validate(malformed));
  }
});
test('HTTP rate limits and network failures remain errors, never source-not-found results',async()=>{
  const previous=globalThis.chrome;
  globalThis.chrome={storage:{local:{get:async()=>({})}}};
  try{
    await assert.rejects(requestAnalysis('/api/preview',{},async()=>({ok:false,status:429})),/429/);
    await assert.rejects(requestAnalysis('/api/preview',{},async()=>{throw new Error('network unavailable');}),error=>error.code==='network_error');
  }finally{globalThis.chrome=previous;}
});
test('settings preserve the server port but request a valid host permission and clear legacy keys only on click',async()=>{
  const previousDocument=globalThis.document, previousChrome=globalThis.chrome;
  const dom=new JSDOM('<input id="backendUrl"><span id="saved" hidden></span><button id="save"></button><button id="clear-legacy"></button>');
  let origins,saved,removed;
  globalThis.document=dom.window.document;
  globalThis.chrome={storage:{local:{get:async()=>({}),set:async value=>{saved=value;},remove:async keys=>{removed=keys;}}},permissions:{request:async value=>{origins=value.origins;return true;}}};
  try{
    await import('../newscheck 4/options/options.js?settings-test');
    assert.equal(removed,undefined);
    document.getElementById('backendUrl').value='http://127.0.0.1:8000';
    document.getElementById('save').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(origins,['http://127.0.0.1/*']);
    assert.deepEqual(saved,{backendUrl:'http://127.0.0.1:8000'});
    document.getElementById('clear-legacy').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(removed.includes('apiKey'));
  }finally{globalThis.document=previousDocument;globalThis.chrome=previousChrome;}
});
