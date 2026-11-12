import { extractArticle, findQuote } from '../lib/extract.js';
import { articleRequest } from '../shared/article.js';
import { renderAnalysis, renderAnalysisState, esc } from '../shared/view.js';
import { validateAnalysis } from '../shared/api.js';
const demo = new URLSearchParams(location.search).has('demo');
const content = document.getElementById('content');
let generation = 0, currentId = null, expanded = new Set();
function state(message, retry = false) {
  content.innerHTML = '<div class="state" role="status"><p>' + esc(message) + '</p>' + (retry ? '<button id="retry" class="btn">다시 시도</button>' : '') + '</div>';
  content.querySelector('#retry')?.addEventListener('click', () => analyze(true));
}
async function analyze(refresh = false) {
  const run = ++generation;
  document.getElementById('article-head').hidden = true;
  state('기사와 출처를 분석하는 중입니다.');
  let activeMetadata=null;
  try {
    let result;
    if (demo) result = await (await fetch('../data/demo.json')).json();
    else {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('지원하는 뉴스 기사 페이지를 열어 주세요.');
      const [extracted] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractArticle});
      if (run !== generation) return;
      if (!extracted.result?.isArticle) throw new Error('기사 본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.');
      const payload=articleRequest(extracted.result,refresh);
      activeMetadata=payload.metadata;
      renderAnalysisState(content,activeMetadata,'loading','기사의 근거와 출처를 분석하는 중입니다.',expanded);
      const response = await chrome.runtime.sendMessage({type:'NEWSCHECK_ANALYZE',payload});
      if (!response?.ok) throw new Error(response?.error || '분석 서버에 연결하지 못했습니다.');
      result = response.data;
    }
    if (run !== generation) return;
    validateAnalysis(result);
    if (currentId !== result.article_id) { expanded = new Set(); currentId = result.article_id; }
    renderAnalysis(content,result,expanded);
    document.getElementById('article-title').textContent = result.article.title;
    document.getElementById('article-meta').textContent = [result.article.publisher,result.article.author].filter(Boolean).join(' · ');
    document.getElementById('article-head').hidden = false;
  } catch(e) {
    if (run !== generation) return;
    document.getElementById('article-head').hidden = true;
    if(activeMetadata)renderAnalysisState(content,activeMetadata,'error',e.message || '분석 요청에 실패했습니다.',expanded);
    else state(e.message || '분석 요청에 실패했습니다.',true);
  }
}
content.addEventListener('click', async e => {
  if(e.target.closest('[data-retry]')){analyze(true);return;}
  const button = e.target.closest('[data-quote]');
  if (!button || demo) return;
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (tab) chrome.scripting.executeScript({target:{tabId:tab.id},func:findQuote,args:[button.dataset.quote]}).catch(() => {});
});
document.getElementById('btn-refresh').onclick = () => analyze(true);
document.getElementById('btn-settings').onclick = () => chrome.runtime.openOptionsPage();
if (!demo) {
  chrome.tabs.onActivated.addListener(() => analyze());
  chrome.tabs.onUpdated.addListener((id,change,tab) => { if (tab.active && (change.url || change.status === 'complete')) analyze(); });
  chrome.storage.onChanged.addListener((changes) => { if(changes.backendUrl) analyze(true); });
}
analyze();
