import { requestAnalysis } from './shared/api.js';
const panel = () => chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
chrome.runtime.onInstalled.addListener(panel);
chrome.runtime.onStartup?.addListener(panel);
const articleHost = url => ['news.naver.com','n.news.naver.com'].includes(new URL(url).hostname);
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  if (!['NEWSCHECK_ANALYZE','NEWSCHECK_PREVIEW','NEWSCHECK_SELECTION','NEWSCHECK_FETCH_ARTICLE'].includes(message?.type)) return false;
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('허용되지 않은 요청입니다.');
    if (message.type === 'NEWSCHECK_FETCH_ARTICLE') {
      const url = new URL(message.url);
      if (url.protocol !== 'https:' || !articleHost(url) || !/\/(?:mnews\/)?article\//.test(url.pathname) || url.username || url.password) throw new Error('지원하지 않는 기사 링크입니다.');
      const response = await fetch(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('클릭 전 기사 본문을 확보하지 못했습니다.');
      const html = await response.text();
      if (html.length > 2000000) throw new Error('기사 페이지가 너무 큽니다.');
      return {html,url:url.href};
    }
    const path = {NEWSCHECK_ANALYZE:'/api/articles/analyze',NEWSCHECK_PREVIEW:'/api/preview',NEWSCHECK_SELECTION:'/api/claims/check'}[message.type];
    return await requestAnalysis(path,message.payload);
  })().then(data => sendResponse({ok:true,data})).catch(e => sendResponse({ok:false,error:e.message || '분석 요청 실패'}));
  return true;
});
