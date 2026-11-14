import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const root=path.resolve('dist/newscheck');
const server=http.createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/__popup-test.html') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><head><title>Popup test</title></head><body></body></html>');return;
  }
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  try {
    const content=await fs.readFile(file);
    const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'}[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});res.end(content);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:440,height:900},colorScheme:'light'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/sidepanel/sidepanel.html?demo');
  const toggles=page.locator('[data-toggle]');
  await toggles.last().waitFor();assert.equal(await toggles.count(),6);
  await toggles.nth(0).press('Enter');
  await toggles.nth(3).press('Space');
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'),'true');
  assert.equal(await toggles.nth(3).getAttribute('aria-expanded'),'true');
  await toggles.nth(0).click();
  assert.equal(await toggles.nth(3).getAttribute('aria-expanded'),'true');
  await page.locator('#btn-refresh').click();
  await page.waitForFunction(()=>document.querySelector('[data-toggle="evidence"]')?.getAttribute('aria-expanded')==='true');
  assert.equal(await page.locator('.demo-banner').count(),1);
  assert.equal(await page.locator('a[href*=".example"]').count(),0);
  const text=await page.locator('body').innerText();
  assert.doesNotMatch(text,/신뢰도|거짓 또는 오류|다른 보도와 일치|종합 신뢰 지수|\d+점|\d+%/);
  assert.equal(await page.locator('.notice-card').getAttribute('aria-label'),'출처 확인·주의 상태');
  assert.equal(await page.locator('.notice-card').evaluate(el=>el.classList.contains('notice-caution')),true);
  await page.locator('[data-notice-details]').click();
  assert.equal(await page.locator('#details-cautions').isVisible(),true);
  assert.equal(await toggles.nth(3).getAttribute('aria-expanded'),'true');
  await page.locator('[data-toggle="cautions"]').click();
  await toggles.nth(3).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await fs.mkdir('.tools',{recursive:true});
  await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.locator('#content > :first-child').getAttribute('class'),'card headline-explanation');
  assert.equal(await page.locator('.headline-reasons > li').count(),2);
  assert.equal(await page.locator('#summary-context .context-main').count(),1);
  for(const label of await page.locator('#summary-context .context-step p').all()){
    assert.ok(!(await label.innerText()).includes('…'));
    assert.equal(await label.evaluate(el=>el.scrollHeight<=el.clientHeight),true);
  }
  await page.screenshot({path:'.tools/panel.png',fullPage:true});
  // Compact overview: summary on the left, smaller metadata on the right.
  const narrowContext=await page.locator('[data-section="context"]').boundingBox();
  const narrowMetadata=await page.locator('[data-section="metadata"]').boundingBox();
  const narrowSummary=await page.locator('.analysis-summary').boundingBox();
  assert.equal(narrowMetadata.y,narrowSummary.y);assert.ok(narrowMetadata.x>narrowSummary.x);
  assert.ok(narrowMetadata.width<narrowSummary.width);assert.ok(narrowContext.y>=narrowMetadata.y+narrowMetadata.height);
  assert.equal(await page.locator('.summary-list > li').count(),2);
  assert.equal(await page.locator('#summary-context .context-step').count(),2);
  assert.equal(await page.locator('#summary-context .context-arrow').count(),1);
  for(const row of await page.locator('#summary-related .related-row').all())assert.ok((await row.boundingBox()).height<45);
  await page.setViewportSize({width:880,height:1000});
  const boxes=await Promise.all(['context','metadata','claims','evidence','cautions','related'].map(id=>page.locator('[data-section="'+id+'"]').boundingBox()));
  const wideSummary=await page.locator('.analysis-summary').boundingBox();
  assert.equal(boxes[1].y,wideSummary.y);assert.ok(boxes[1].width<wideSummary.width);
  assert.ok(boxes[0].y>=boxes[1].y+boxes[1].height);
  assert.equal(boxes[2].x,boxes[0].x);assert.ok(boxes[3].x>boxes[2].x);
  assert.equal(boxes[4].x,boxes[0].x);assert.equal(boxes[4].width,boxes[0].width);
  assert.equal(boxes[5].width,boxes[4].width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.tools/panel-reference-layout.png',fullPage:true});
  await page.locator('[data-toggle="related"]').click();
  const reports=page.locator('#details-related .report-detail');
  assert.equal(await page.locator('#details-related .report-detail[open]').count(),0);
  await reports.first().locator('summary').click();
  assert.equal(await reports.first().locator('.report-body').isVisible(),true);
  assert.equal(await reports.nth(1).locator('.report-body').isVisible(),false);
  await page.screenshot({path:'.tools/panel-related-detail.png',fullPage:true});
  await page.locator('[data-toggle="related"]').click();
  await page.setViewportSize({width:320,height:900});
  const smallSummary=await page.locator('.analysis-summary').boundingBox();
  const smallMetadata=await page.locator('[data-section="metadata"]').boundingBox();
  assert.equal(smallMetadata.y,smallSummary.y);assert.ok(smallMetadata.width<smallSummary.width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'.tools/panel-compact-320.png',fullPage:true});
  await page.setViewportSize({width:440,height:900});
  await page.locator('[data-headline-toggle]').press('Enter');
  await page.locator('[data-headline-jump="0"]').click();
  assert.equal(await page.locator('#details-evidence').isVisible(),true);
  assert.equal(await page.locator('#headline-details').isVisible(),true);
  assert.ok((await page.evaluate(()=>document.activeElement.id)).startsWith('evidence-mention-'));
  await page.waitForFunction(()=>{
    const target=document.activeElement,rect=target.getBoundingClientRect();
    return target.id.startsWith('evidence-') && rect.top>=65 && rect.top<=90;
  });
  await page.screenshot({path:'.tools/headline-evidence-jump.png'});
  await page.locator('[data-headline-toggle]').click();
  assert.equal(await page.locator('#details-evidence').isVisible(),true);
  await page.locator('[data-toggle="evidence"]').click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.emulateMedia({colorScheme:'dark'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.tools/headline-dark.png',fullPage:true});
  await page.emulateMedia({colorScheme:'light'});
  await page.locator('[data-toggle="cautions"]').click();
  await page.locator('[data-section="cautions"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:'.tools/cautions-clean.png'});
  // Exercise content-script events with deterministic server responses, not real API calls.
  const fixture=JSON.parse(await fs.readFile(path.join(root,'data/demo.json'),'utf8'));
  const origin='http://127.0.0.1:'+server.address().port;
  const reviewPage=await browser.newPage({viewport:{width:440,height:900},colorScheme:'light'});
  reviewPage.on('pageerror',e=>errors.push(e.message));
  await reviewPage.goto(origin+'/sidepanel/sidepanel.html?demo');
  await reviewPage.locator('[data-toggle="related"]').waitFor();
  await reviewPage.evaluate(async fixture=>{
    const {renderAnalysis}=await import('/shared/view.js');
    const report=fixture.related_articles[0];
    Object.assign(report,{title:'지원 규모를 다룬 다른 시연 보도',comparison_status:'compared',comparison_basis:'body_excerpt',cited_by_article:false,original_candidate:true,
      comparison_points:[{kind:'difference',aspect:'figures',article_quote:'2027년 지원금은 올해보다 확대할 계획이라고 발표했다.',
        related_quote:'2027년 지원금은 올해보다 축소할 계획이라고 발표했다.',review_kind:'claim_conflict',
        context_anchor:'2027년 지원금',review_status:'paired_excerpt'}]});
    renderAnalysis(document.getElementById('content'),fixture,new Set(['claims']));
  },fixture);
  assert.equal(await reviewPage.locator('.notice-review').count(),1);
  assert.match(await reviewPage.locator('.notice-review').innerText(),/교차검증 필요/);
  assert.match(await reviewPage.locator('.odiff').innerText(),/원문 후보 · 인용 관계 미확인/);
  assert.match(await reviewPage.locator('.odiff').innerText(),/교차검증 필요/);
  assert.doesNotMatch(await reviewPage.locator('.notice-review').innerText(),/왜곡했습니다|\d+점/);
  await reviewPage.screenshot({path:'.tools/report-review-panel.png',fullPage:true});
  await reviewPage.locator('.notice-card [data-report-review]').click();
  const reviewReport=reviewPage.locator('#related-report-'+fixture.related_articles[0].id);
  assert.equal(await reviewReport.getAttribute('open'),'');
  assert.equal(await reviewPage.locator('#details-claims').isVisible(),true);
  assert.match(await reviewReport.innerText(),/확대할 계획/);
  assert.match(await reviewReport.innerText(),/축소할 계획/);
  await reviewReport.screenshot({path:'.tools/report-review-detail.png'});
  for(const width of [320,440]){
    await reviewPage.setViewportSize({width,height:900});
    assert.equal(await reviewPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await reviewPage.emulateMedia({colorScheme:'dark'});
  assert.equal(await reviewPage.locator('.report-review').first().isVisible(),true);
  await reviewPage.close();
  const contentPage=await browser.newPage({viewport:{width:1000,height:900}});
  await contentPage.goto(origin+'/__popup-test.html');
  const selectedText=fixture.claims[0].original_text;
  const articleHtml='<html><head><title>전기차 지원제도 검토에 관한 시연용 기사</title></head><body><a id="hover-link" href="https://news.naver.com/article/001/123456">시연용 기사 제목에 마우스 올리기</a><article><h1>전기차 지원제도 검토에 관한 시연용 기사</h1><div class="article-body"><p id="selected-para">'+selectedText+'</p><p>'+fixture.claims[1].original_text.repeat(8)+'</p></div></article></body></html>';
  await contentPage.setContent(articleHtml);
  await contentPage.evaluate(({origin,fixture,articleHtml})=>{
    window._messages=[];
    window.chrome.runtime={id:'browser-test-extension',getURL:p=>origin+'/'+p,sendMessage:async m=>{
      window._messages.push(m);
      if(m.type==='NEWSCHECK_GET_CACHED_ARTICLE')return {ok:true,data:{payload:null}};
      if(m.type==='NEWSCHECK_FETCH_ARTICLE')return {ok:true,data:{html:articleHtml,url:m.url}};
      if(m.type==='NEWSCHECK_PREVIEW')return {ok:true,data:{article_id:fixture.article_id,is_demo:true,summary:fixture.one_line_summary,major_evidence:fixture.evidence_mentions,sources:fixture.sources,headline_difference:fixture.headline_difference,one_line_caution:fixture.caution.reasons[0],search_status:fixture.search_status}};
      if(m.type==='NEWSCHECK_SELECTION')return new Promise(resolve=>{
        window._releaseSelection=()=>resolve({ok:true,data:{article_id:fixture.article_id,selected_text:m.payload.selected_text,is_demo:true,claims:fixture.claims,sources:fixture.sources,caution:fixture.caution}});
      });
      throw new Error('Unexpected message');
    }};
  },{origin,fixture,articleHtml});
  contentPage.on('pageerror',e=>errors.push(e.message));
  await contentPage.addScriptTag({url:origin+'/content.js'});
  await contentPage.locator('#__newscheck_popup').waitFor({state:'attached'});
  await contentPage.evaluate(async()=>{
    const link=document.querySelector('#hover-link');
    link.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:20,clientY:20}));
    await new Promise(resolve=>setTimeout(resolve,50));
    link.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));
  });
  await contentPage.waitForTimeout(650);
  assert.equal(await contentPage.evaluate(()=>window._messages.length),0);
  await contentPage.locator('#hover-link').hover();
  await contentPage.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('핵심 요약'));
  assert.equal(await contentPage.evaluate(()=>window._messages.filter(m=>m.type==='NEWSCHECK_PREVIEW').length),1);
  await contentPage.keyboard.press('Escape');
  await contentPage.evaluate(()=>{
    const p=document.getElementById('selected-para'),range=document.createRange();range.selectNodeContents(p);
    getSelection().removeAllRanges();getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:100,clientY:180}));
  });
  await contentPage.locator('#__newscheck_popup #trace-selection').click();
  await contentPage.waitForFunction(()=>typeof window._releaseSelection==='function');
  await contentPage.mouse.move(900,800);
  await contentPage.waitForTimeout(350);
  assert.equal(await contentPage.locator('#__newscheck_popup .box').isVisible(),true,'Moving away must keep selected-sentence analysis visible');
  await contentPage.locator('#hover-link').hover();
  await contentPage.waitForTimeout(650);
  assert.match(await contentPage.locator('#__newscheck_popup .body').innerText(),/선택 문장의 출처를 분석/);
  assert.equal(await contentPage.evaluate(()=>window._messages.filter(m=>m.type==='NEWSCHECK_PREVIEW').length),1,'Hover must not replace pinned selection analysis');
  await contentPage.evaluate(()=>window._releaseSelection());
  await contentPage.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('원본 자료 확인'));
  await contentPage.locator('#__newscheck_popup .body').click({position:{x:10,y:10}});
  await contentPage.mouse.move(900,800);
  await contentPage.waitForTimeout(350);
  assert.equal(await contentPage.locator('#__newscheck_popup .box').isVisible(),true,'Selection results must remain visible after pointer leave');
  await contentPage.mouse.click(900,800);
  assert.equal(await contentPage.locator('#__newscheck_popup .box').isVisible(),false,'Outside click must close selection results');
  const messages=await contentPage.evaluate(()=>window._messages);
  const request=messages.find(m=>m.type==='NEWSCHECK_SELECTION');
  assert.equal(request.payload.selected_text,selectedText);
  assert.ok(request.payload.page_text.includes(selectedText));
  assert.ok(request.payload.surrounding_text.includes(selectedText));
  // Simulate the stale content script left behind by an extension reload.
  // Chrome can throw synchronously, reject asynchronously, or remove runtime.id.
  for (const failure of ['throw','reject','missing-id']) {
    const stalePage=await browser.newPage({viewport:{width:1000,height:900}});
    stalePage.on('pageerror',e=>errors.push(e.message));
    await stalePage.goto(origin+'/__popup-test.html');
    await stalePage.setContent(articleHtml);
    await stalePage.evaluate(({origin})=>{
      window._attempts=0;window.chrome.runtime={id:'stale-test',getURL:p=>origin+'/'+p,sendMessage:async()=>({ok:true,data:{}})};
    },{origin});
    await stalePage.addScriptTag({url:origin+'/content.js'});
    await stalePage.locator('#__newscheck_popup').waitFor({state:'attached'});
    await stalePage.evaluate(failure=>{
      if(failure==='missing-id')delete window.chrome.runtime.id;
      window.chrome.runtime.sendMessage=()=>{
        window._attempts++;
        if(failure==='throw')throw new Error('Extension context invalidated.');
        return Promise.reject(new Error('Extension context invalidated.'));
      };
    },failure);
    await stalePage.locator('#hover-link').hover();
    await stalePage.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('새로고침(F5)'));
    assert.doesNotMatch(await stalePage.locator('#__newscheck_popup .body').innerText(),/Extension context invalidated/);
    await stalePage.keyboard.press('Escape');
    await stalePage.mouse.move(900,800);
    await stalePage.locator('#hover-link').hover();
    await stalePage.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('새로고침(F5)'));
    assert.equal(await stalePage.evaluate(()=>window._attempts),failure==='missing-id'?0:1,'A detached script must not retry extension/API calls');
    await stalePage.close();
  }
  const startupPage=await browser.newPage();
  startupPage.on('pageerror',e=>errors.push(e.message));
  await startupPage.goto(origin+'/__popup-test.html');
  await startupPage.evaluate(()=>{window.chrome.runtime={};});
  await startupPage.addScriptTag({url:origin+'/content.js'});
  await startupPage.getByRole('alert').waitFor();
  assert.match(await startupPage.getByRole('alert').innerText(),/새로고침\(F5\)/);
  await startupPage.getByRole('button',{name:'닫기',exact:true}).click();
  assert.equal(await startupPage.getByRole('alert').count(),0);
  await startupPage.close();
  assert.deepEqual(errors,[]);
  console.log('Chrome headless: panel layout, cross-report red notice and quote navigation, independent cards, Hover/selection and invalidated-context handling passed.');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
