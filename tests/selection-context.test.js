import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import {selectionContext,isSingleWord,selectionPageUrl} from '../newscheck 4/shared/selection.js';
import {renderSelection,renderWord} from '../newscheck 4/shared/view.js';
import {validateWord} from '../newscheck 4/shared/api.js';
function select(html,selector,start=0,end) {
  const dom=new JSDOM(html),node=dom.window.document.querySelector(selector).firstChild;
  const range=dom.window.document.createRange();range.setStart(node,start);range.setEnd(node,end??node.textContent.length);
  const selection=dom.window.getSelection();selection.addRange(range);return selection;
}
test('single words include one-letter Korean and inflected words, while sentences keep trace analysis',()=>{
  for(const word of ['벼랑','벼랑끝','실패하면','Nobel','AI','핵','co-operation'])assert.equal(isSingleWord(word),true);
  for(const text of ['여러 단어','문장입니다.','123','!'])assert.equal(isSingleWord(text),false);
});
test('blank frames use their actual HTTP referrer and unsupported URLs are not invented',()=>{
  assert.equal(selectionPageUrl({location:{href:'about:blank'},referrer:'https://generic.example/article'}),'https://generic.example/article');
  assert.equal(selectionPageUrl({location:{href:'chrome://settings'},referrer:''}),null);
});
test('short generic pages use a labelled excerpt rather than silently rejecting a selection',()=>{
  const s=select('<main><p>정책 개편을 검토하지만 시행 시점은 미정이다.</p></main>','p');
  const result=selectionContext(s,{isArticle:false,body:''});
  assert.equal(result.scope,'page_excerpt');assert.ok(result.body.includes(result.text));
});
test('selections omitted by body truncation or extraction fall back to their actual DOM context',()=>{
  const s=select('<p>여기에서 선택한 문장은 추출된 기사 앞부분에 없다.</p>','p',5,20);
  const result=selectionContext(s,{isArticle:true,body:'기사 앞부분만 추출됐다.'});
  assert.equal(result.scope,'page_excerpt');assert.ok(result.surrounding.includes(result.text));
});
test('article selections retain full-body context and controls/editable text are excluded',()=>{
  const text='정부는 새 방안을 검토하고 있다.';
  const result=selectionContext(select('<p>'+text+'</p>','p'),{isArticle:true,body:text});
  assert.equal(result.scope,'article');
  assert.equal(selectionContext(select('<div contenteditable="true">비공개 입력 내용</div>','div'),{}),null);
});
test('the same word in different paragraphs keeps its selected context rather than the first occurrence',()=>{
  const html='<article><p id="a">강의 은행 주변을 걸었다.</p><p id="b">금융 은행에서 계좌를 만들었다.</p></article>';
  const body='강의 은행 주변을 걸었다. 금융 은행에서 계좌를 만들었다.';
  const first=selectionContext(select(html,'#a',3,5),{isArticle:true,body});
  const second=selectionContext(select(html,'#b',3,5),{isArticle:true,body});
  assert.equal(first.text,second.text);assert.notEqual(first.surrounding,second.surrounding);
  assert.match(first.surrounding,/강의/);assert.match(second.surrounding,/금융/);
});
test('all ordinary HTTP(S) pages and frames receive selection scripts, with matching public modules',()=>{
  const manifest=JSON.parse(fs.readFileSync('newscheck 4/manifest.json','utf8'));
  for(const scheme of ['http','https']) {
    assert.ok(manifest.content_scripts.some(s=>s.matches.includes(scheme+'://*/*')&&s.all_frames));
    assert.ok(manifest.web_accessible_resources.some(s=>s.matches.includes(scheme+'://*/*')&&s.resources.includes('shared/selection.js')));
  }
});
const word=()=>({word_id:'word_test',selected_text:'벼랑',lemma:'벼랑',is_demo:true,context_scope:'page_excerpt',
  general_meaning:'시연용 일반 의미',contextual_meaning:'불리하고 위태로운 상황을 비유',context_quote:'실패하면 벼랑 끝에 몰린다는 뜻이다.',
  dictionary_status:'not_found',dictionary_meaning:'',dictionary_sources:[],pipeline_errors:[]});
test('word UI distinguishes unverified AI explanations from sourced dictionary definitions',()=>{
  const r=word();assert.equal(validateWord(r),r);
  assert.match(renderWord(r),/일반적 의미 · AI 설명/);assert.match(renderWord(r),/사전 뜻풀이 미확인/);
  r.dictionary_status='search_only';r.dictionary_meaning='가파르게 깎아지른 낭떠러지';
  r.dictionary_sources=[{id:'dict_1',url:'https://krdict.korean.go.kr/entry',title:'사전 검색 자료',excerpt:'시연용 뜻풀이',basis:'search_snippet'}];
  assert.equal(validateWord(r),r);assert.match(renderWord(r),/사전 자료의 의미/);assert.match(renderWord(r),/원문은 확인하지 못했습니다/);
  r.dictionary_status='not_found';assert.throws(()=>validateWord(r),/미확인 사전/);
});
test('selected text remains visible even without claims, and both popup types escape untrusted text',()=>{
  const selected='<img src=x onerror=alert(1)>';
  const html=renderSelection({selected_text:selected,context_scope:'page_excerpt',is_demo:false,claims:[],sources:[],caution:{status:'unknown',reasons:['출처 미확인']}});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.match(html,/선택한 문장/);
  const r=word();r.general_meaning=selected;assert.ok(!renderWord(r).includes('<img'));
});
