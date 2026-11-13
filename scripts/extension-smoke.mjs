// Load the actual MV3 package. Network traffic is restricted to local fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const root = path.resolve('dist/newscheck');
const fixture = JSON.parse(await fs.readFile(path.join(root, 'data/demo.json'), 'utf8'));
const articleUrl = process.env.TEST_ARTICLE_URL || 'https://n.news.naver.com/mnews/article/001/0000000001';
const title = '전기차 지원제도 검토에 관한 시연용 기사';
const selected = fixture.claims[0].original_text;
const bodyText = fixture.claims.map(c => c.original_text).join(' ').repeat(3);
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html = `<html><head><title>${title}</title><meta property="og:title" content="${title}"></head><body>
<a id="hover-link" href="${articleUrl}">시연용 기사 제목</a><button id="outside" type="button">다른 영역</button><article><h1>${title}</h1>
<div id="dic_area"><p id="selected">${escape(selected)}</p><p>${escape(bodyText)}</p></div></article></body></html>`;
const counts = {analyze:0,lookup:0,selection:0};
let analysis;
let onSelectionRequest;
const selectionReplies = [];
function nextSelectionRequest() {
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>reject(new Error('Selection HTTP request did not arrive')),10000);
    onSelectionRequest = reply => { clearTimeout(timeout); resolve(reply); };
  });
}
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const payload = raw ? JSON.parse(raw) : {};
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/articles/analyze') {
    counts.analyze++;
    analysis = {...fixture, article:{...fixture.article,url:payload.url,title:payload.title},
      body_hash:createHash('sha256').update(payload.page_text).digest('hex')};
    return res.end(JSON.stringify(analysis));
  }
  if (req.url.startsWith('/api/articles/')) {
    counts.lookup++; return res.end(JSON.stringify(analysis));
  }
  if (req.url === '/api/claims/check') {
    counts.selection++;
    const reply = () => {
      if (!res.writableEnded) res.end(JSON.stringify({article_id:analysis.article_id,is_demo:true,selected_text:payload.selected_text,
        claims:fixture.claims,sources:fixture.sources,caution:fixture.caution,pipeline_errors:[]}));
    };
    selectionReplies.push(reply);
    onSelectionRequest?.(reply);
    return;
  }
  res.writeHead(404); res.end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const backendUrl = 'http://127.0.0.1:' + server.address().port;
const scratch = path.resolve('.tools');
await fs.mkdir(scratch, {recursive:true});
const profile = await fs.mkdtemp(path.join(scratch, 'extension-profile-'));
let context;
const errors = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true, viewport:{width:1100,height:850},
    ...(process.env.EXTENSION_CHROMIUM_PATH ? {executablePath:process.env.EXTENSION_CHROMIUM_PATH} : {}),
    args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === articleUrl) return route.fulfill({contentType:'text/html; charset=utf-8', body:html});
    if (url.startsWith(backendUrl + '/') || url.startsWith('chrome-extension://')) return route.continue();
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:15000});
  const extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options/options.html`);
  await settings.evaluate(async backendUrl => {
    await chrome.storage.local.set({backendUrl, autoBadge:false});
  }, backendUrl);
  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(articleUrl);
  try { await page.locator('#__newscheck_popup').waitFor({state:'attached',timeout:7000}); }
  catch { throw new Error('Content script did not initialize: ' + errors.join(' | ')); }
  const payload = {url:articleUrl,title,page_text:(selected+' '+bodyText).replace(/\s+/g,' ').trim()};
  const response = await settings.evaluate(payload => chrome.runtime.sendMessage({type:'NEWSCHECK_ANALYZE',payload}), payload);
  assert.equal(response.ok, true, response.error);
  await page.locator('#hover-link').hover();
  const popup = page.locator('#__newscheck_popup');
  await popup.locator('.body').filter({hasText:'핵심 요약'}).waitFor({state:'visible',timeout:10000});
  assert.equal(counts.lookup, 1, 'Hover must reach the actual worker cache lookup');
  assert.equal(counts.analyze, 1, 'Warm Hover must reuse analysis');
  await page.screenshot({path:'.tools/extension-hover.png'});
  // Leaving the link schedules Hover's close timer. It must not close a new selection popup.
  await page.mouse.move(1000, 780);
  await page.evaluate(() => {
    const p = document.querySelector('#selected');
    const range = document.createRange(); range.selectNodeContents(p);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:80,clientY:140}));
    p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:140}));
  });
  const button = popup.locator('#trace-selection');
  await button.waitFor({state:'visible'});
  await page.waitForTimeout(300);
  assert.equal(await button.isVisible(), true, 'An old Hover close timer must not hide the selection popup');
  assert.equal(counts.selection, 0, 'Selecting alone must not call the API');
  const firstRequest = nextSelectionRequest();
  await button.click();
  const finishFirst = await firstRequest;
  await page.mouse.move(1000,780);
  await page.waitForTimeout(350);
  assert.equal(await popup.locator('.box').isVisible(),true,'Pending selection must survive pointer leave');
  await page.locator('#hover-link').hover();
  await page.waitForTimeout(650);
  assert.match(await popup.locator('.body').innerText(),/선택 문장의 출처를 분석/);
  assert.equal(counts.lookup,1,'Hover must not replace pinned selection analysis');
  finishFirst();
  await popup.locator('.body').filter({hasText:'문장 유형과 출처'}).waitFor({state:'visible',timeout:10000});
  assert.equal(counts.selection, 1);
  await popup.locator('.body').click({position:{x:10,y:10}});
  await page.mouse.move(1000,780);
  await page.waitForTimeout(350);
  assert.equal(await popup.locator('.box').isVisible(),true,'Selection results must survive pointer leave and inside clicks');
  await page.screenshot({path:'.tools/extension-selection.png'});
  await page.mouse.click(1000,780);
  assert.equal(await popup.locator('.box').isVisible(),false,'Outside click must close selection');
  await page.evaluate(() => {
    const p=document.querySelector('#selected'), range=document.createRange(); range.selectNodeContents(p);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:80,clientY:140}));
  });
  const secondRequest=nextSelectionRequest();
  await button.click();
  const finishSecond=await secondRequest;
  await page.locator('#outside').click();
  assert.equal(await popup.locator('.box').isVisible(),false);
  finishSecond();
  await page.waitForTimeout(350);
  assert.equal(await popup.locator('.box').isVisible(),false,'Late response must not reopen a dismissed selection');
  await page.locator('#hover-link').hover();
  await popup.locator('.body').filter({hasText:'핵심 요약'}).waitFor({state:'visible',timeout:10000});
  await popup.locator('.box').hover();
  await page.mouse.move(1000,780);
  await page.waitForTimeout(350);
  assert.equal(await popup.locator('.box').isVisible(),false,'Hover must still close on pointer leave');
  assert.deepEqual(errors, []);
  console.log('Actual MV3 extension passed at ' + new URL(articleUrl).hostname + ': Hover leave unchanged, pinned selection during delayed HTTP and link hover, outside dismissal, late-response guard. No live APIs.');
} finally {
  selectionReplies.forEach(reply=>reply());
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  // Only remove the unique test profile created above, inside the workspace scratch directory.
  assert.ok(path.resolve(profile).startsWith(scratch + path.sep));
  await fs.rm(profile,{recursive:true,force:true});
}
