import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {extractArticle} from '../newscheck 4/lib/extract.js';

const root=path.resolve('dist/newscheck'),articleUrl='https://n.news.naver.com/mnews/article/001/0000000001';
const moduleBase='https://n.news.naver.com/__newscheck_test_extension/';
const fixture=await fs.readFile('fixtures/naver_article.html','utf8');
const nativeFetch=globalThis.fetch;
const staticServer=http.createServer(async(req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    const data=await fs.readFile(file);
    const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+staticServer.address().port;
const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const backend='http://127.0.0.1:'+port;
const venv=path.resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const python=process.env.PYTHON_PATH||(syncFs.existsSync(venv)?venv:process.platform==='win32'?'python':'python3');
const child=spawn(python,['scripts/run_integration_server.py',String(port)],{
  windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ANALYSIS_MODE:'mock',GEMINI_API_KEY:'',TAVILY_API_KEY:'',LLM_MODEL:''}});
let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-4000);});
const exit=new Promise(resolve=>child.once('close',resolve));
let browser,stopped=false;
async function stopBackend(){if(stopped)return;stopped=true;child.stdin.end('stop\n');await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Mock backend did not stop')),12000))]);}
const results=[],counts={articleFetch:0,analyze:0,preview:0,selection:0,lookup:0};
try{
  let ready=false;
  for(let i=0;i<100;i++){
    try{if((await (await nativeFetch(backend+'/health')).json()).mode==='mock'){ready=true;break;}}catch{}
    if(child.exitCode!==null)throw new Error('Integration server failed: '+stderr);
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'Mock HTTP server did not start');
  globalThis.fetch=async(url,options)=>{
    const value=String(url);
    if(value.startsWith('https://n.news.naver.com/')||value.startsWith('https://news.naver.com/')){counts.articleFetch++;return new Response(fixture,{status:200});}
    assert.ok(value.startsWith(backend+'/api/'),'Unexpected network destination');
    if(value.includes('/api/articles/analyze'))counts.analyze++;
    else if(value.includes('/api/preview'))counts.preview++;
    else if(value.includes('/api/claims/check'))counts.selection++;
    else counts.lookup++;
    return nativeFetch(url,options);
  };
  let receiver;
  globalThis.chrome={runtime:{id:'integration-extension',onMessage:{addListener:fn=>{receiver=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
    storage:{local:{get:async()=>({backendUrl:backend})}},sidePanel:{setPanelBehavior:async()=>{}},tabs:{onUpdated:{addListener(){}}}};
  const {articleInputs}=await import('../newscheck 4/background.js');
  const send=message=>new Promise(resolve=>receiver(message,{id:chrome.runtime.id,tab:{id:1,url:articleUrl}},value=>{results.push({message,result:value});resolve(value);}));
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1000,height:900},colorScheme:'light'});
  await context.route('https://n.news.naver.com/**',async route=>{
    const value=route.request().url();
    if(value.startsWith(moduleBase)){
      const file=path.resolve(root,decodeURIComponent(value.slice(moduleBase.length)));
      if(!file.startsWith(root+path.sep)){await route.abort();return;}
      try{await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:await fs.readFile(file)});}catch{await route.fulfill({status:404,body:''});}
    }else if(value===articleUrl)await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture});
    else await route.fulfill({status:404,body:''});
  });
  const errors=[];
  const article=await context.newPage();article.on('pageerror',e=>errors.push(e.message));
  await article.exposeFunction('__sendNewscheck',send);
  await article.addInitScript(({moduleBase})=>{window.chrome=window.chrome||{};window.chrome.runtime={getURL:name=>moduleBase+name,sendMessage:m=>window.__sendNewscheck(m)};},{moduleBase});
  await article.goto(articleUrl);
  const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));
  await panel.setViewportSize({width:440,height:900});
  await panel.exposeFunction('__sendNewscheck',send);
  await panel.exposeFunction('__extractNewscheck',async name=>name==='extractArticle'?[{result:await article.evaluate(extractArticle)}]:[]);
  await panel.addInitScript(({articleUrl})=>{
    window.chrome=window.chrome||{};
    window.chrome.runtime={sendMessage:m=>window.__sendNewscheck(m),openOptionsPage:async()=>{}};
    window.chrome.tabs={query:async()=>[{id:1,url:articleUrl,active:true}],onActivated:{addListener(){}},onUpdated:{addListener(){}}};
    window.chrome.storage={onChanged:{addListener(){}}};
    window.chrome.scripting={executeScript:async options=>window.__extractNewscheck(options.func.name)};
  },{articleUrl});
  // A + D: actual extraction → actual worker/client → HTTP FastAPI → demo providers → six-card UI.
  await panel.goto(origin+'/sidepanel/sidepanel.html');
  await panel.locator('.demo-banner').waitFor();
  assert.equal(await panel.locator('[data-toggle]').count(),6);
  const full=results.find(r=>r.message.type==='NEWSCHECK_ANALYZE').result.data;
  assert.equal(full.article.url,articleUrl);assert.equal(full.article.author,'김가상');
  assert.equal(full.article.event_location,'서울');assert.equal(full.article.event_time,'2026년 11월 10일');
  assert.ok(full.sources.some(s=>s.original_status==='original_found'&&s.facts.authorship));
  assert.ok(full.caution.details.some(d=>d.source_ids.length));
  assert.equal(full.claims[0].original_text,results[0].message.payload.page_text.slice(full.claims[0].article_span.start,full.claims[0].article_span.end));
  assert.ok(full.context_timeline[0].source_ids.length);
  assert.equal(full.related_articles[0].comparison_status,'compared');
  assert.equal(full.related_articles[0].comparison_basis,'search_snippet');
  assert.ok(full.related_articles[0].comparison_points.some(point=>point.kind==='common'));
  assert.ok(full.related_articles[0].comparison_points.some(point=>point.kind==='difference'));
  assert.equal(counts.analyze,1);
  for(const id of ['context','metadata','claims','evidence','cautions','related'])await panel.locator('[data-toggle="'+id+'"]').click();
  await panel.locator('#details-related .report-detail > summary').first().click();
  assert.equal(await panel.locator('#details-related .report-pair').count(),2);
  assert.ok((await panel.locator('#details-related').innerText()).includes('검색 요약 범위 비교'));
  await panel.locator('[data-section="related"]').screenshot({path:'.tools/report-comparison.png'});
  await panel.setViewportSize({width:320,height:900});
  assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await panel.locator('[data-section="related"]').screenshot({path:'.tools/report-comparison-narrow.png'});
  await panel.setViewportSize({width:440,height:900});
  await panel.screenshot({path:'.tools/integration-panel.png',fullPage:true});
  // B: short Hover does nothing; warm Hover reads GET cache without collecting HTML again.
  await article.addScriptTag({url:moduleBase+'content.js'});
  await article.locator('#__newscheck_popup').waitFor({state:'attached'});
  await article.locator('#hover-link').hover();await article.waitForTimeout(100);await article.mouse.move(950,850);await article.waitForTimeout(650);
  assert.equal(counts.lookup,0);
  await article.locator('#hover-link').hover();
  await article.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('핵심 요약'));
  assert.equal(counts.lookup,1);assert.equal(counts.articleFetch,0);assert.equal(counts.analyze,1);
  await article.keyboard.press('Escape');
  articleInputs.delete(articleUrl);
  await article.mouse.move(950,850);await article.locator('#hover-link').hover();
  await article.waitForFunction(()=>{const root=document.querySelector('#__newscheck_popup');return root.style.display==='block'&&root.shadowRoot.querySelector('.body').textContent.includes('주요 주장');});
  assert.equal(counts.articleFetch,1);assert.equal(counts.preview,1);
  const preview=results.find(r=>r.message.type==='NEWSCHECK_PREVIEW').result.data;
  assert.equal(preview.article_id,full.article_id);assert.equal(preview.body_hash,full.body_hash);
  // C: existing claim reuse and a new selected sentence share the same parent article.
  for(const index of [0,3]){
    await article.keyboard.press('Escape');
    const text=await article.locator('#dic_area p').nth(index).innerText();
    await article.evaluate(index=>{const p=document.querySelectorAll('#dic_area p')[index],range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:100,clientY:200}));},index);
    await article.locator('#__newscheck_popup #trace-selection').click();
    await article.waitForFunction(()=>document.querySelector('#__newscheck_popup').shadowRoot.querySelector('.body').textContent.includes('문장 유형과 출처'));
    const last=results.filter(r=>r.message.type==='NEWSCHECK_SELECTION').at(-1).result;
    assert.equal(last.ok,true);assert.equal(last.data.article_id,full.article_id);
    assert.equal(last.data.claims[0].original_text,text.replace(/\s+/g,' ').trim());
  }
  const lookup=await (await nativeFetch(backend+'/api/articles/'+full.article_id+'?url='+encodeURIComponent(articleUrl))).json();
  assert.equal(lookup.analyzed_at,full.analyzed_at);assert.deepEqual(lookup.claims,full.claims);
  // A real connection failure is displayed on all affected cards, with retry and page metadata.
  await stopBackend();await panel.locator('#btn-refresh').click();
  await panel.locator('[data-retry]').waitFor();
  assert.equal(await panel.locator('[data-toggle]').count(),6);
  assert.equal(await panel.locator('.section-state').filter({hasText:'처리 실패'}).count(),5);
  assert.deepEqual(errors,[]);
  console.log('A/B/C/D integration passed: extraction + actual worker + HTTP mock pipeline + all UI, warm/cold Hover, known/new selection, source/caution links, shared cache and real server-off errors.');
  console.log(JSON.stringify({counts,article_id:full.article_id,is_demo:full.is_demo}));
}finally{
  globalThis.fetch=nativeFetch;
  await browser?.close();
  await stopBackend().catch(()=>child.kill());
  await new Promise(r=>staticServer.close(r));
}
