import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {extractArticle} from '../newscheck 4/lib/extract.js';
import {articleRequest,normalizeArticleUrl} from '../newscheck 4/shared/article.js';
import {ArticleInputCache} from '../newscheck 4/shared/cache.js';
const parser=new JSDOM().window.DOMParser;
const fixture=fs.readFileSync(new URL('../fixtures/naver_article.html',import.meta.url),'utf8');
function extract(html,url='https://n.news.naver.com/mnews/article/001/0000000001'){
  const previous=globalThis.DOMParser;globalThis.DOMParser=parser;
  try{return extractArticle(html,url);}finally{globalThis.DOMParser=previous;}
}
test('representative Naver DOM preserves publication/update, event, cited link and quotations',()=>{
  const article=extract(fixture);
  assert.equal(article.isArticle,true);assert.equal(article.press,'가상신문');assert.deepEqual(article.reporters,['김가상']);
  assert.equal(article.published,'2026-11-11T10:24:00+09:00');assert.equal(article.modified,'2026-11-11T14:37:00+09:00');
  assert.equal(article.event_time,'2026년 11월 10일');assert.equal(article.event_location,'서울');
  assert.equal(article.article_context.cited_links[0].url,'https://sources.example/demo-document');
  assert.ok(article.article_context.quotations.includes('구매 시점이 달라질 수 있다'));
  const request=articleRequest(article);
  assert.equal(request.metadata.event_location,'서울');assert.equal(request.article_context.body_truncated,false);
  assert.equal(request.page_text.includes('\n'),false);
});
test('missing publication metadata never substitutes a date from the event body',()=>{
  const article=extract('<h1>사건 날짜만 있는 시연용 기사 제목</h1><article><p>'+('2026년 10월 1일 서울에서 행사가 열렸다. 다음 일정은 확인되지 않았다. ').repeat(8)+'</p></article>');
  assert.equal(article.published,'');assert.equal(article.modified,'');assert.equal(article.event_time,null);
  assert.equal(articleRequest(article).metadata.published_at,null);
});
test('body truncation is explicit and unsupported or hidden source URLs are excluded',()=>{
  const article=extract('<h1>길이가 긴 시연용 기사 제목과 자료</h1><article><p><a href="javascript:alert(1)">잘못된 링크</a><a href="https://user:pass@example.com">인증 링크</a>'+('긴 본문을 읽고 자료를 확인합니다. ').repeat(1500)+'</p></article><a href="https://outside.example/">본문 밖 링크</a>');
  assert.equal(article.body.length,12000);assert.equal(article.article_context.body_truncated,true);
  assert.deepEqual(article.article_context.cited_links,[]);
  assert.equal(extract('<h1>본문이 없는 페이지입니다</h1>').isArticle,false);
});
test('canonical URL and bounded input cache reuse input while expiring stale articles',()=>{
  const url='https://n.news.naver.com/mnews/article/001/1?utm_source=test&b=2&a=1#section';
  assert.equal(normalizeArticleUrl(url),'https://n.news.naver.com/mnews/article/001/1?a=1&b=2');
  let clock=0;const cache=new ArticleInputCache({clock:()=>clock,ttl:10,max:2});
  const payload={url,page_text:'본문',metadata:{url},refresh:true};cache.put(payload,'first');
  const entry=cache.get(url);entry.payload.page_text='변경';assert.equal(cache.get(url).payload.page_text,'본문');
  assert.equal(cache.get(url).payload.refresh,false);
  cache.put({...payload,page_text:'새 본문'},'new',2);cache.put(payload,'old',1);
  assert.equal(cache.get(url).article_id,'new');
  cache.put({url:'https://example.org/2',page_text:'두번째'},'second');cache.put({url:'https://example.org/3',page_text:'세번째'},'third');
  assert.equal(cache.get(url),null);clock=11;assert.equal(cache.get('https://example.org/3'),null);
});
