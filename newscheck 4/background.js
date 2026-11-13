import { requestAnalysis, getAnalysis } from './shared/api.js';
import { normalizeArticleUrl } from './shared/article.js';
import { ArticleInputCache } from './shared/cache.js';
import { extractArticle, markHeadline } from './lib/extract.js';
import { articleRequest } from './shared/article.js';
import { badgeInfo } from './shared/summary.js';
const panel=()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.runtime.onInstalled.addListener(panel);
chrome.runtime.onStartup?.addListener(panel);
export const articleInputs=new ArticleInputCache();
const pages=new Map(),fetches=new Map();
let requestOrder=0;
const allowed=new Set(['NEWSCHECK_ANALYZE','NEWSCHECK_PREVIEW','NEWSCHECK_SELECTION','NEWSCHECK_FETCH_ARTICLE','NEWSCHECK_GET_CACHED_ARTICLE']);
function articleUrl(value) {
  const url=new URL(normalizeArticleUrl(value));
  if(url.protocol!=='https:' || !['news.naver.com','n.news.naver.com'].includes(url.hostname) || !/\/(?:mnews\/)?article\//.test(url.pathname))throw new Error('지원하지 않는 기사 링크입니다.');
  return url.href;
}
async function fetchArticle(value) {
  const url=articleUrl(value),cached=pages.get(url);
  if(cached?.expires>Date.now())return cached.data;
  if(fetches.has(url))return fetches.get(url);
  const task=(async()=>{
    const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('클릭 전 기사 본문을 확보하지 못했습니다.');
    const html=await response.text();
    if(html.length>2000000)throw new Error('기사 페이지가 너무 큽니다.');
    const data={html,url};
    if(pages.size>=64)pages.delete(pages.keys().next().value);
    pages.set(url,{data,expires:Date.now()+30000});
    return data;
  })();
  fetches.set(url,task);
  try{return await task;}finally{fetches.delete(url);}
}
export async function dispatchMessage(message,sender) {
  if(sender.id!==chrome.runtime.id)throw new Error('허용되지 않은 요청입니다.');
  if(message.type==='NEWSCHECK_FETCH_ARTICLE')return fetchArticle(message.url);
  if(message.type==='NEWSCHECK_GET_CACHED_ARTICLE'){
    const url=articleUrl(message.url),entry=articleInputs.get(url);
    if(!entry)return {payload:null};
    const analysis=await getAnalysis(entry.article_id,url);
    if(!analysis){articleInputs.delete(url);return {payload:null};}
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(entry.payload.page_text));
    const hash=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(analysis.body_hash!==hash){articleInputs.delete(url);return {payload:null};}
    return {payload:entry.payload,analysis};
  }
  const path={NEWSCHECK_ANALYZE:'/api/articles/analyze',NEWSCHECK_PREVIEW:'/api/preview',NEWSCHECK_SELECTION:'/api/claims/check'}[message.type];
  if(!path)throw new Error('지원하지 않는 요청입니다.');
  const revision=++requestOrder;
  let payload=message.payload;
  if(message.type==='NEWSCHECK_SELECTION' && !payload.article_id){
    const entry=articleInputs.get(payload.url);
    if(entry && entry.payload.page_text===payload.page_text && JSON.stringify(entry.payload.metadata)===JSON.stringify(payload.metadata) && JSON.stringify(entry.payload.article_context)===JSON.stringify(payload.article_context || {cited_links:[],quotations:[],body_truncated:false}))payload={...payload,article_id:entry.article_id};
  }
  const data=await requestAnalysis(path,payload);
  articleInputs.put(message.payload,data.article_id,revision);
  return data;
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!allowed.has(message?.type))return false;
  dispatchMessage(message,sender).then(data=>sendResponse({ok:true,data}))
    .catch(e=>sendResponse({ok:false,error:e.message || '분석 요청 실패',code:e.code || 'request_failed',retry_after_seconds:e.retry_after_seconds ?? null}));
  return true;
});
chrome.tabs?.onUpdated?.addListener((id,change,tab)=>{
  if(change.status==='loading' && tab.url){articleInputs.delete(tab.url);try{pages.delete(normalizeArticleUrl(tab.url));}catch{}}
});
// 기사를 열면 자동으로 분석하고 제목 옆에 "근거 확인 현황" 배지를 붙인다.
// 설정에서 끌 수 있고, 사용자가 허용한 사이트(네이버 뉴스 포함)에서만 동작한다.
const autoRuns=new Map();
// 페이지 안에서 실행되므로 외부 변수를 쓰지 않는다. 기사임을 밝히는 표지(og:type, JSON-LD, 발행 시각 meta)를 본다.
function looksLikeNewsArticle() {
  const meta=(sel)=>document.querySelector(sel)?.getAttribute('content')||'';
  if(/^article$/i.test(meta('meta[property="og:type"]')))return true;
  if(meta('meta[property="article:published_time"]'))return true;
  const kinds=/^(NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|LiveBlogPosting)$/;
  const find=(node)=>{
    if(!node||typeof node!=='object')return false;
    if(Array.isArray(node))return node.some(find);
    const type=node['@type'];
    if([].concat(type||[]).some(t=>kinds.test(String(t))))return true;
    return find(node['@graph']);
  };
  for(const el of document.querySelectorAll('script[type="application/ld+json"]')){
    try{if(find(JSON.parse(el.textContent)))return true;}catch{}
  }
  return false;
}
async function autoBadge(tabId,url) {
  let pendingTitle=null;
  try {
    const settings=await chrome.storage.local.get('autoBadge');
    if(settings.autoBadge===false)return;
    if(!await chrome.permissions.contains({origins:[new URL(url).origin+'/*']}))return;
    const key=normalizeArticleUrl(url);
    if(autoRuns.get(tabId)===key)return;
    autoRuns.set(tabId,key);
    // 서버로 보내기 전에 페이지가 뉴스 기사로 선언돼 있는지 먼저 확인한다(기사가 아니면 아무것도 보내지 않는다).
    const [probe]=await chrome.scripting.executeScript({target:{tabId},func:looksLikeNewsArticle});
    // 네이버 기사 페이지는 표지가 없어도 기존 방식(본문 추출)으로 계속 처리한다.
    if(!probe?.result && !/(^|\.)naver\.com$/.test(new URL(url).hostname))return;
    const [extracted]=await chrome.scripting.executeScript({target:{tabId},func:extractArticle});
    if(!extracted?.result?.isArticle)return;
    // 분석이 끝나기를 기다리지 않고 먼저 "분석 중" 표시를 띄운다.
    pendingTitle=extracted.result.title;
    await showChip(tabId,pendingTitle,'분석 중…','','기사의 근거를 확인하고 있어요. 잠시만 기다려 주세요.');
    const data=await dispatchMessage({type:'NEWSCHECK_ANALYZE',payload:articleRequest(extracted.result,false)},{id:chrome.runtime.id});
    const info=badgeInfo(data);
    if(!info || autoRuns.get(tabId)!==key)return;
    await chrome.scripting.executeScript({target:{tabId},func:markHeadline,args:[data.article.title,info]});
  } catch {
    // 실패해도 기사 읽기를 방해하지 않는다. 표시만 바꾸고 패널에서 다시 분석할 수 있게 안내한다.
    if(pendingTitle && autoRuns.get(tabId))await showChip(tabId,pendingTitle,'분석 실패','','일시적으로 분석하지 못했어요. 뉴스체크 아이콘을 눌러 다시 시도해 주세요.').catch(()=>{});
  }
}
function showChip(tabId,title,label,caution,headline) {
  const info={label,caution,headline,lines:[],partial:false,note:'출처 확인은 주장의 진실성을 입증하지 않습니다.'};
  return chrome.scripting.executeScript({target:{tabId},func:markHeadline,args:[title,info]});
}
chrome.tabs?.onUpdated?.addListener((id,change,tab)=>{
  if(change.status==='loading')autoRuns.delete(id);
  if(change.status==='complete' && tab.url && /^https?:/.test(tab.url))autoBadge(id,tab.url);
});