import { extractArticle, findQuote, markHeadline } from '../lib/extract.js';
import { badgeInfo } from '../shared/summary.js';
import { articleRequest, normalizeArticleUrl } from '../shared/article.js';
import { renderAnalysis, renderAnalysisState, esc } from '../shared/view.js';
import { validateAnalysis } from '../shared/api.js';
const demo = new URLSearchParams(location.search).has('demo');
const content = document.getElementById('content');
let generation = 0, currentId = null, expanded = new Set();
// 탭을 오갈 때마다 다시 분석하지 않도록 기사별 결과를 잠시 기억한다("다시 분석"은 항상 새로 분석).
const results = new Map();
const RESULT_TTL = 30 * 60 * 1000;
const resultKey = (url) => { try { return normalizeArticleUrl(url); } catch { return null; } };
function show(result, tabId) {
  validateAnalysis(result);
  if (currentId !== result.article_id) { expanded = new Set(); currentId = result.article_id; }
  renderAnalysis(content,result,expanded);
  document.getElementById('article-title').textContent = result.article.title;
  document.getElementById('article-meta').textContent = [result.article.publisher,result.article.author].filter(Boolean).join(' · ');
  document.getElementById('article-head').hidden = false;
  // 기사 페이지의 제목 옆에도 배지를 붙인다 (실패해도 패널 동작에는 영향 없음)
  const info = badgeInfo(result);
  if (!demo && tabId != null && info) chrome.scripting.executeScript({target:{tabId},func:markHeadline,args:[result.article.title,info]}).catch(() => {});
}
function state(message, retry = false) {
  content.innerHTML = '<div class="state" role="status"><p>' + esc(message) + '</p>' + (retry ? '<button id="retry" class="btn">다시 시도</button>' : '') + '</div>';
  content.querySelector('#retry')?.addEventListener('click', () => analyze(true));
}
function permissionNeeded(url) {
  const origin = new URL(url).origin + '/*';
  content.innerHTML = '<div class="state" role="status"><p>이 사이트의 기사를 읽으려면 권한이 필요해요.<br>뉴스체크 아이콘을 누르거나, 아래 버튼으로 이 사이트만 허용할 수 있어요.</p><button id="grant" class="btn">이 사이트 허용</button></div>';
  content.querySelector('#grant').addEventListener('click', async () => {
    try { if (await chrome.permissions.request({origins:[origin]})) analyze(true); } catch { /* 사용자가 거절하면 그대로 둔다 */ }
  });
}
async function analyze(refresh = false) {
  const run = ++generation;
  if (!refresh && !demo) {
    try {
      const [t] = await chrome.tabs.query({active:true,currentWindow:true});
      const hit = t?.url && /^https?:/.test(t.url) ? results.get(resultKey(t.url)) : null;
      if (hit && Date.now() - hit.at < RESULT_TTL) { if (run !== generation) return; show(hit.result, t.id); return; }
    } catch { /* 확인에 실패하면 평소처럼 분석한다 */ }
    if (run !== generation) return;
  }
  document.getElementById('article-head').hidden = true;
  state('기사와 출처를 분석하는 중입니다.');
  let activeMetadata=null, activeTabId=null;
  try {
    let result;
    if (demo) result = await (await fetch('../data/demo.json')).json();
    else {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('지원하는 뉴스 기사 페이지를 열어 주세요.');
      activeTabId = tab.id;
      let extracted;
      try {
        [extracted] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractArticle});
      } catch (err) {
        if (/must request permission|Cannot access contents/i.test(String(err?.message))) { permissionNeeded(tab.url); return; }
        throw err;
      }
      if (run !== generation) return;
      if (!extracted.result?.isArticle) throw new Error('기사 본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.');
      const payload=articleRequest(extracted.result,refresh);
      activeMetadata=payload.metadata;
      renderAnalysisState(content,activeMetadata,'loading','기사의 근거와 출처를 분석하는 중입니다.',expanded);
      const response = await chrome.runtime.sendMessage({type:'NEWSCHECK_ANALYZE',payload});
      if (!response?.ok) throw new Error(response?.error || '분석 서버에 연결하지 못했습니다.');
      result = response.data;
      const key = resultKey(tab.url);
      if (key && !result.ui_state) results.set(key, {result, at: Date.now()});
    }
    if (run !== generation) return;
    show(result, activeTabId);
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