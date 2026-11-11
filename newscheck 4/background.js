import { requestAnalysis, getAnalysis } from './shared/api.js';
import { normalizeArticleUrl } from './shared/article.js';
import { ArticleInputCache } from './shared/cache.js';
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
