import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderAnalysis, renderAnalysisState, renderPreview, renderSelection, safeLink, reasonPhrase, formatEventDate } from '../newscheck 4/shared/view.js';
import { validateAnalysis, validateSelection, validatePreview, requestAnalysis, backendUrl } from '../newscheck 4/shared/api.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../newscheck 4/data/demo.json',import.meta.url),'utf8'));

test('headline meaning and reasons have separate headings and reasons retain meaning as brief phrases',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,fixture);
  assert.equal(root.querySelector('#headline-explanation-title').textContent,'제목의 의미');
  assert.equal(root.querySelector('.headline-reasons-title').textContent,'이유');
  assert.equal(reasonPhrase('이란 측은 청해부대 임무 확대가 미국의 대이란 침략 가담 행위라고 주장했다.'),'이란 측은 청해부대 임무 확대가 미국의 대이란 침략 가담 행위라고 주장');
  assert.equal(reasonPhrase('기관은 추가 조치 가능성을 경고했습니다.'),'기관은 추가 조치 가능성을 경고');
  assert.equal(reasonPhrase('정책 시행은 확정되지 않았다.'),'정책 시행은 확정되지 않음');
  assert.equal(reasonPhrase('내년부터 시행할 수 있다.'),'내년부터 시행할 수 있음');
  assert.equal(reasonPhrase('아직 검토 중이다.'),'아직 검토 중');
});

test('Hover is concise and excludes claims, evidence, sources and source caution lists',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  root.innerHTML=renderPreview({is_demo:true,summary:'핵심 내용 한 문장입니다.',claims:fixture.claims,
    major_evidence:fixture.evidence_mentions,sources:fixture.sources,headline_difference:'제목은 검토 단계를 강조합니다.',
    one_line_caution:'확인이 필요한 근거',pipeline_errors:[{message:'상세 출처 확인 오류'}]});
  assert.deepEqual([...root.querySelectorAll('h3')].map(el=>el.textContent),['핵심 요약','제목·본문 표현 차이']);
  assert.equal(root.querySelectorAll('.source-row').length,0);
  assert.doesNotMatch(root.textContent,/주요 주장|주요 근거|확인이 필요한 근거|상세 출처 확인 오류/);
  assert.match(root.textContent,/핵심 내용 한 문장/);
});
test('headline meaning is first, reasons are plain bullets and evidence jumps preserve other cards',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),expanded=new Set(['claims']);
  renderAnalysis(root,fixture,expanded);
  assert.equal(root.firstElementChild.classList.contains('headline-explanation'),true);
  assert.equal(root.querySelector('.headline-meaning').textContent,fixture.headline_explanation.meaning);
  assert.equal(root.querySelectorAll('.headline-reasons > li').length,fixture.headline_explanation.reasons.length);
  assert.equal(root.querySelectorAll('.headline-reasons a').length,0);
  const toggle=root.querySelector('[data-headline-toggle]');toggle.click();
  assert.equal(root.querySelector('#headline-details').hidden,false);
  root.querySelector('[data-headline-jump="0"]').click();
  assert.equal(root.querySelector('#details-claims').hidden,false);
  assert.equal(root.querySelector('[data-toggle="claims"]').getAttribute('aria-expanded'),'true');
  assert.equal(document.activeElement.id,'evidence-mention-'+fixture.headline_explanation.reasons[0].mention_ids[0]);
  assert.equal(root.querySelectorAll('[data-toggle]').length,4);
});

test('headline reasons without linked sources lead to the claims card and missing legacy fields remain usable',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  Object.assign(data.headline_explanation.reasons[0],{mention_ids:[],source_ids:[]});
  renderAnalysis(root,data,new Set(['headline']));
  root.querySelector('[data-headline-jump="0"]').click();
  assert.equal(document.activeElement.dataset.section,'claims');
  assert.equal(root.querySelector('.trace-strip'),null,'근거 확인 현황 카드는 표시하지 않음');
  delete data.headline_explanation;
  assert.equal(validateAnalysis(data),data);renderAnalysis(root,data);
  assert.match(root.querySelector('.headline-explanation').textContent,/제목 설명이 아직 없습니다/);
});

test('headline text is escaped and invented reason links or multiple main events are rejected',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  data.headline_explanation.meaning='<img src=x onerror=alert(1)>';
  renderAnalysis(root,data);
  assert.equal(root.querySelector('.headline-explanation img'),null);
  assert.ok(root.querySelector('.headline-meaning').textContent.includes('<img'));
  data.headline_explanation.reasons[0].source_ids=['invented'];
  assert.throws(()=>validateAnalysis(data),/제목 이유 참조/);
  const wrong=structuredClone(fixture);wrong.context_timeline.forEach(t=>t.is_main_event=true);
  assert.throws(()=>validateAnalysis(wrong),/주요 사건/);
});

test('context boxes use short phrases with a separate date and one emphasized main event',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,fixture);
  const boxes=[...root.querySelectorAll('#summary-context .context-step')];
  assert.equal(boxes.filter(b=>b.classList.contains('context-main')).length,1);
  assert.deepEqual(boxes.map(b=>b.querySelector('p').textContent),fixture.context_timeline.map(t=>t.label));
  assert.ok(boxes.every(b=>!b.querySelector('p').textContent.includes('…')));
  // 원문 날짜는 그대로, 날짜가 없으면 '시점 미확인' 대신 보도 시점(기사 작성일)을 구분해 표시
  boxes.forEach((b,i)=>{
    const date=fixture.context_timeline[i].date, tag=b.querySelector('.context-date');
    if(date && date!=='시점 미확인') { assert.equal(tag.textContent,formatEventDate(date)); assert.ok(!tag.classList.contains('context-date-report')); }
    else { assert.match(tag.textContent,/^\d{4}년 \d{1,2}월 \d{1,2}일 \(보도일\)$/); assert.ok(tag.classList.contains('context-date-report')); }
  });
  assert.doesNotMatch(root.querySelector('#summary-context').textContent,/시점 미확인/);
  // 기사 작성일도 없으면 날짜 칸을 비운다
  const noDate=structuredClone(fixture); noDate.article.published_at=null;
  noDate.context_timeline.forEach(t=>t.date='시점 미확인');
  renderAnalysis(root,noDate);
  assert.equal(root.querySelectorAll('#summary-context .context-date').length,0);
});

test('four independent accessible controls keep all other cards open and survive refresh',()=>{
  const document=new JSDOM('<main></main>').window.document;
  const root=document.querySelector('main'), expanded=new Set();
  renderAnalysis(root,fixture,expanded);
  const buttons=[...root.querySelectorAll('[data-toggle]')];
  assert.equal(buttons.length,4);
  for(const button of buttons) {
    assert.equal(button.tagName,'BUTTON');
    assert.equal(button.getAttribute('aria-expanded'),'false');
    button.click();
    assert.equal(button.getAttribute('aria-expanded'),'true');
    assert.equal(document.getElementById(button.getAttribute('aria-controls')).hidden,false);
  }
  assert.equal(expanded.size,4);
  buttons[2].click();
  assert.equal(expanded.size,3);
  assert.equal(buttons[0].getAttribute('aria-expanded'),'true');
  renderAnalysis(root,fixture,expanded);
  assert.equal(root.querySelectorAll('[data-toggle][aria-expanded="true"]').length,3);
});
test('all displays use source states and a visible demo label, never a truth score',()=>{
  const document=new JSDOM('<main></main>').window.document;
  renderAnalysis(document.querySelector('main'),fixture);
  const html=document.body.innerHTML;
  assert.match(html,/시연용 예시/);
  assert.match(html,/원본 자료 확인/);
  assert.doesNotMatch(html,/신뢰도|다른 보도와 일치|거짓 또는 오류|확인된 사실|\d+%|종합 신뢰 지수/);
  const preview=renderPreview({is_demo:true,summary:fixture.one_line_summary,major_evidence:fixture.evidence_mentions,sources:fixture.sources,headline_difference:fixture.headline_difference,one_line_caution:fixture.caution.reasons[0]});
  const selection=renderSelection({is_demo:true,claims:fixture.claims,sources:fixture.sources,caution:fixture.caution});
  for(const rendered of [preview,selection]) {
    assert.match(rendered,/시연용 예시/);
    assert.doesNotMatch(rendered,/신뢰도|반박됨|일부 확인|거짓 또는 오류/);
  }
});
test('source notice replaces score UI with linked cautions and preserves independent card controls',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysis(root,fixture,new Set(['claims']));
  const card=document.querySelector('.notice-card');
  assert.ok(card);
  assert.equal(card.getAttribute('aria-label'),'출처 확인·주의 상태');
  assert.match(card.textContent,/주의 필요|확인 정보 부족|확보한 범위/);
  assert.match(card.textContent,/사실·거짓이나 언론사의 신뢰 등급을 판정하지 않습니다/);
  assert.equal(root.querySelector('.ncs-pct,.ncs-bar,.ncs-score'),null);
  assert.equal(card.querySelectorAll('.notice-list > li').length<=3,true);
  assert.doesNotMatch(card.textContent,/\d+점|\d+%|사진 자료의 날짜|교차검증|계산에서 제외/);
  assert.doesNotMatch(card.textContent,/거짓 또는 오류|확인된 사실|가짜 뉴스|허위/);
  // '주의할 것' 카드가 없어졌으므로 그 카드로 이동하는 버튼도 없다
  assert.equal(card.querySelector('[data-notice-details]'),null);
  assert.equal(root.querySelector('[data-section="cautions"]'),null);
  assert.equal(root.querySelector('#details-claims').hidden,false);
  assert.equal(root.querySelectorAll('[data-toggle]').length,4);
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
test('report comparisons show scope and paired excerpts without changing the four-card controls',()=>{
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
  assert.equal(root.querySelectorAll('[data-toggle]').length,4);
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
  assert.equal(root.querySelectorAll('[data-toggle]').length,4);
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
test('four cards display loading, errors and retry while preserving page metadata',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  renderAnalysisState(root,fixture.article,'loading','분석 대기');
  assert.equal(root.querySelectorAll('[data-toggle]').length,4);
  assert.equal([...root.querySelectorAll('.section-state')].filter(e=>e.textContent.includes('분석 중')).length,3);
  renderAnalysisState(root,fixture.article,'error','서버 오류 <script>');
  assert.equal(root.querySelectorAll('[data-retry]').length,1);
  assert.equal([...root.querySelectorAll('.section-state')].filter(e=>e.textContent.includes('처리 실패')).length,3);
  assert.equal(root.querySelector('script'),null);
  assert.ok(root.textContent.includes(fixture.article.publisher));
});
test('caution references are validated and unknown references are rejected',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main');
  const a=structuredClone(fixture);
  a.caution.details=[{reason:'작성 기관의 이해관계 관련 문구 확인',source_ids:[a.sources[0].id],claim_ids:[a.claims[0].id]}];
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
test('foreign-language claims and evidence show a Korean AI translation beside the original quote',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  data.claims[0].translation='김정은은 비핵화를 내세워 제재를 약화하려 한다';
  data.evidence_mentions[0].translation='그는 2007년 김정일을 만났다';
  data.evidence_mentions[0].article_quote=data.evidence_mentions[0].description='He met Kim Jong-il in 2007.';
  renderAnalysis(root,data,new Set(['claims']));
  assert.match(root.querySelector('#summary-claims').textContent,/주장 1\s*김정은은 비핵화를/);
  const claims=root.querySelector('#details-claims').textContent;
  assert.ok(claims.includes(data.claims[0].original_text),'원문 인용 유지');
  assert.match(claims,/AI 번역\s*김정은은 비핵화를/);
  assert.match(root.querySelector('#details-claims .evidence-list').textContent,/AI 번역\s*그는 2007년/);
  // 번역이 없는 한국어 기사는 기존 표시 그대로
  const plain=new JSDOM('<main></main>').window.document.querySelector('main');
  renderAnalysis(plain,fixture,new Set(['claims']));
  assert.doesNotMatch(plain.textContent,/AI 번역/);
  const selection=renderSelection({is_demo:true,claims:data.claims.slice(0,1),sources:[],caution:fixture.caution});
  assert.match(selection,/AI 번역/);
});

test('evidence identical to a claim is not repeated and shows only its source',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  // 시연 데이터처럼 근거 문장이 주장 원문과 같은 경우
  data.evidence_mentions[0].article_quote=data.claims[0].original_text;
  data.evidence_mentions[0].source_label='가상정책연구소';
  data.evidence_mentions[0].translation='반복되면 안 되는 번역';
  renderAnalysis(root,data,new Set(['claims']));
  const item=root.querySelector('#details-claims .evidence-item');
  assert.match(item.textContent,/출처: 가상정책연구소/);
  assert.match(item.textContent,/주장 문장 안에 출처가 함께 적혀 있어요/);
  assert.equal(item.querySelector('blockquote'),null,'주장 문장을 근거로 다시 인용하지 않음');
  assert.doesNotMatch(root.querySelector('#details-claims').textContent,/반복되면 안 되는 번역/);
  assert.ok(item.querySelector('[data-quote]'),'본문에서 보기 유지');
  // 출처 표기가 없으면 연결된 주장의 발언자를 쓴다
  data.evidence_mentions[0].source_label=null; data.claims[0].speaker='이성윤 교수';
  renderAnalysis(root,data,new Set(['claims']));
  assert.match(root.querySelector('#details-claims .evidence-item').textContent,/출처: 이성윤 교수/);
});

test('claims and their evidence share one card: collapsed shows claims only, expanded nests evidence under each claim',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),expanded=new Set();
  renderAnalysis(root,fixture,expanded);
  assert.equal(root.querySelector('[data-section="evidence"]'),null);
  assert.equal(root.querySelector('[data-section="cautions"]'),null);
  const card=root.querySelector('[data-section="claims"]');
  assert.equal(card.querySelector('h2').textContent,'기사의 주장과 근거');
  const button=card.querySelector('[data-toggle="claims"]');
  assert.equal(button.textContent,'근거 보기 ›');
  // 접힌 상태: 모든 주장이 번호와 함께 나오고 근거 내용은 나오지 않는다
  assert.equal(card.querySelectorAll('#summary-claims .claim-list > li').length,fixture.claims.length);
  assert.equal(card.querySelector('#summary-claims .evidence-item'),null);
  button.click();
  assert.equal(button.textContent,'접기 ∧');
  const blocks=[...card.querySelectorAll('#details-claims .claim-details > .claim-block')];
  assert.equal(blocks.length,fixture.claims.length);
  fixture.claims.forEach((c,i)=>{
    assert.match(blocks[i].textContent,new RegExp('주장 '+(i+1)));
    const linked=fixture.evidence_mentions.filter(m=>m.claim_ids.includes(c.id));
    assert.equal(blocks[i].querySelectorAll('.evidence-list > .evidence-item').length,linked.length);
  });
  button.click();
  assert.equal(button.textContent,'근거 보기 ›');
  assert.equal(card.querySelector('#details-claims').hidden,true);
});

test('event dates share one format without inventing missing year or month', () => {
  const cases = {'1950':'1950년','2007년':'2007년','9일(현지 시각)':'9일 (현지시간)','8일(현지시간)':'8일 (현지시간)','9일':'9일',
    '2018.03.09':'2018년 3월 9일','2018년 03월 09일':'2018년 3월 9일','March 12, 2018':'2018년 3월 12일','12 March 2018':'2018년 3월 12일','March 2018':'2018년 3월','지난 3월':'지난 3월','최근':'최근'};
  for (const [raw, want] of Object.entries(cases)) assert.equal(formatEventDate(raw), want, raw);
});

test('panel hides progress notes: no partial-state labels, no incomplete paragraph, no partial error list',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),a=structuredClone(fixture);
  a.section_states={...(a.section_states||{}),claims:{status:'partial'},context:{status:'ready'},related:{status:'partial'}};
  a.search_errors=['일부 검색 자료의 원문을 확보하지 못했습니다. 검색 요약과 구분합니다.'];
  a.pipeline_errors=[{phase:'document_fetch',code:'provider_unavailable',provider:'tavily',message:'공급자 서비스가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.'}];
  renderAnalysis(root,a);
  assert.doesNotMatch(root.textContent,/정보 준비됨|일부 정보 미확인|일부 확인 미완료|공급자 서비스가 일시적으로/);
  assert.equal(root.querySelector('.notice-incomplete'),null);
  // 빈 카드 안내와 분석 중 표시는 유지
  a.section_states.related={status:'empty',message:'관련 기사를 찾지 못했습니다.'};
  renderAnalysis(root,a);
  assert.match(root.querySelector('[data-section="related"] .section-state').textContent,/관련 기사를 찾지 못했습니다/);
});

test('original candidate in the notice is one linked line with the comparison button only',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),a=structuredClone(fixture);
  a.claims.forEach(c=>c.source_status='source_not_found');a.search_status='completed';
  Object.assign(a.related_articles[0],{original_candidate:true,publisher:'BBC',title:'Trump and North Korea talks: The political gamble of the 21st Century'});
  renderAnalysis(root,a);
  const li=root.querySelector('.notice-card .notice-candidate');
  assert.match(li.textContent,/^원문 후보: BBC「Trump and North Korea talks: The political gamble…( \(시연용 링크\))?」/);
  assert.equal(li.querySelectorAll('[data-report-review]').length,1);
  assert.doesNotMatch(li.textContent,/비교 보도 원문|인용했는지/);
});

test('evidence shows the quote with a kind tag, and names the source only when the quote does not already contain it',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),data=structuredClone(fixture);
  const m=data.evidence_mentions[0];
  Object.assign(m,{article_quote:'영국 공영방송 BBC가 9일(현지 시각)',description:'영국 공영방송 BBC가 9일(현지 시각)',source_label:'영국 공영방송 BBC',source_kind:'news_report'});
  data.sources.forEach(s=>s.mention_ids=s.mention_ids.filter(id=>id!==m.id));
  renderAnalysis(root,data,new Set(['claims']));
  const item=root.getElementById?.('evidence-mention-'+m.id) || document.getElementById('evidence-mention-'+m.id);
  assert.match(item.querySelector('blockquote').textContent,/BBC가 9일\(현지 시각\)\s*언론 보도/);
  assert.doesNotMatch(item.textContent,/출처: 영국 공영방송 BBC|자료 종류|원문 자료는 확보하지 못했습니다/);
  m.source_label='브루스 클링너 연구원';
  renderAnalysis(root,data,new Set(['claims']));
  assert.match(document.getElementById('evidence-mention-'+m.id).textContent,/출처: 브루스 클링너 연구원/);
});

test('diff explanations put the question and the translation label on their own line',()=>{
  const css=fs.readFileSync(new URL('../newscheck 4/sidepanel/sidepanel.css',import.meta.url),'utf8');
  assert.match(css,/\.odiff-why b \{ display:block;/);
  assert.match(css,/\.odiff-pair b, \.report-pair b \{ display:block; \}/);
});

test('original-diff card title is as large as the headline title and starts with the alert emoji',()=>{
  const css=fs.readFileSync(new URL('../newscheck 4/sidepanel/sidepanel.css',import.meta.url),'utf8');
  assert.match(css,/\.card h2\.odiff-title \{ font-size:16px;/);
  assert.match(css,/\.headline-heading h2 \{ margin:0; font-size:16px; \}/);
});
test('original-diff card heading reads with the emoji and count',()=>{
  const document=new JSDOM('<main></main>').window.document,root=document.querySelector('main'),a=structuredClone(fixture);
  Object.assign(a.related_articles[0],{original_candidate:true});
  renderAnalysis(root,a);
  const h=root.querySelector('.odiff h2.odiff-title');
  assert.ok(h,'원문과 다른 점 카드가 있어야 함');
  assert.match(h.textContent,/^🚨 원문과 다른 점 \d+건$/);
});
