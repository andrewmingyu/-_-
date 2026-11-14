(async () => {
  const expiredMessage = '확장 프로그램이 갱신되어 이 페이지와의 연결이 끊겼습니다. 기사 페이지를 새로고침(F5)한 뒤 다시 시도해 주세요.';
  let contextExpired = false;
  function runtimeError(error) {
    let active = false;
    try { active = Boolean(chrome.runtime?.id); } catch { /* Detached extension context. */ }
    if (contextExpired || !active || /extension context invalidated/i.test(error?.message || '')) {
      contextExpired = true;
      return new Error(expiredMessage);
    }
    return error;
  }
  async function message(request) {
    if (contextExpired) throw new Error(expiredMessage);
    try {
      if (!chrome.runtime?.id) throw new Error(expiredMessage);
      return await chrome.runtime.sendMessage(request);
    } catch (error) { throw runtimeError(error); }
  }
  let modules;
  try {
    if (!chrome.runtime?.id) throw new Error(expiredMessage);
    modules = await Promise.all([
      import(chrome.runtime.getURL('lib/extract.js')),
      import(chrome.runtime.getURL('shared/article.js')),
      import(chrome.runtime.getURL('shared/view.js'))
    ]);
  } catch (error) {
    // Imports can also be interrupted by an extension reload. Avoid an unhandled rejection.
    const notice = document.createElement('div');
    notice.id = '__newscheck_popup';
    notice.setAttribute('role','alert');
    notice.style.cssText = 'position:fixed;right:16px;top:16px;z-index:2147483647;background:#fff;padding:16px;max-width:380px;color:#222;border:1px solid #ddd;border-radius:12px';
    notice.textContent = runtimeError(error).message;
    const close = document.createElement('button');
    close.textContent = '닫기'; close.onclick = () => notice.remove();
    notice.append(close); document.documentElement.append(notice);
    return;
  }
  const [{extractArticle}, {articleRequest,previewFromAnalysis,isSupportedArticleUrl}, view] = modules;
  const root = document.createElement('div');
  root.id = '__newscheck_popup';
  const shadow = root.attachShadow({mode:'open'});
  shadow.innerHTML = '<style>:host{all:initial;position:fixed;z-index:2147483647;display:none;width:min(410px,calc(100vw - 24px));font:14px/1.6 "Malgun Gothic",sans-serif;color:#222538}*{box-sizing:border-box}.box{max-height:70vh;overflow:auto;background:#fff;border:1px solid #dedbf4;border-radius:16px;padding:18px;box-shadow:0 12px 40px #21263c30}h3{font-size:15px;margin:12px 0 5px}p{margin:5px 0}ul{padding-left:20px}a{color:#5141bf}button{font:inherit;cursor:pointer;border:1px solid #d8d5eb;border-radius:7px;background:#f5f3ff;padding:6px 10px;color:#45339e}.close{float:right}.source-row{border-top:1px solid #eae8f4;padding:9px 0}.trace-badge{display:inline-block;background:#f0f1f7;padding:2px 6px;border-radius:5px;margin:3px}.caution{background:#fff0d8;color:#8a4900}.trace-note,.muted{color:#62677b;font-size:12px}.demo-banner{background:#fff0d8;padding:8px}blockquote{margin:8px 0;padding-left:10px;border-left:2px solid #bcb5e4}</style><div class="box"><button class="close" aria-label="닫기">×</button><div class="body"></div></div>';
  document.documentElement.append(root);
  const body = shadow.querySelector('.body');
  let timer, hideTimer, sequence = 0, target = null;
  let popupMode = null, selectedText = '', selectionOpenedThisGesture = false;
  const hide = () => {
    sequence++; root.style.display = 'none'; target = null;
    popupMode = null; selectedText = ''; selectionOpenedThisGesture = false;
    clearTimeout(timer); clearTimeout(hideTimer);
  };
  shadow.querySelector('.close').onclick = hide;
  root.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  root.addEventListener('mouseleave', () => { if (popupMode === 'hover') hideTimer = setTimeout(hide,200); });
  function show(x,y,html) {
    body.innerHTML = html;
    root.style.display = 'block';
    root.style.left = Math.max(12,Math.min(x+12,innerWidth- Math.min(410,innerWidth-24)-12)) + 'px';
    root.style.top = Math.max(12,Math.min(y+16,innerHeight-root.getBoundingClientRect().height-12)) + 'px';
  }
  async function send(type,payload) {
    const result = await message({type,payload});
    if(!result?.ok) throw new Error(result?.error || '출처 분석 요청에 실패했습니다.');
    return result.data;
  }
  document.addEventListener('mouseover', e => {
    if (popupMode === 'selection') return;
    const anchor = e.target.closest?.('a[href]');
    if (!anchor || root.contains(anchor)) return;
    let url; try { url = new URL(anchor.href); } catch { return; }
    if (!isSupportedArticleUrl(url.href)) return;
    if (target === anchor) { clearTimeout(hideTimer); return; }
    hide(); popupMode = 'hover'; target = anchor;
    const run = ++sequence, x=e.clientX,y=e.clientY;
    timer=setTimeout(async () => {
      show(x,y,'<p>기사 본문과 출처를 수집하는 중입니다.</p>');
      try {
        const cached=await message({type:'NEWSCHECK_GET_CACHED_ARTICLE',url:url.href});
        if(run!==sequence)return;
        if(cached?.ok && cached.data?.analysis){show(x,y,view.renderPreview(previewFromAnalysis(cached.data.analysis)));return;}
        if(cached && !cached.ok)throw new Error(cached.error || '캐시된 분석을 조회하지 못했습니다.');
        const response = await message({type:'NEWSCHECK_FETCH_ARTICLE',url:url.href});
        if (run !== sequence) return;
        if(!response?.ok) throw new Error(response?.error || '기사 본문 확보 실패');
        const article = extractArticle(response.data.html,response.data.url);
        if(!article.isArticle) throw new Error('본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.');
        const preview = await send('NEWSCHECK_PREVIEW',articleRequest(article));
        if(run === sequence) show(x,y,view.renderPreview(preview));
      } catch(error) { if(run === sequence) show(x,y,'<p>' + view.esc(error.message) + '</p>'); }
    },250);
  });
  document.addEventListener('mouseout', e => {
    if (popupMode === 'hover' && target && target.contains(e.target) && !target.contains(e.relatedTarget) && !root.contains(e.relatedTarget)) {
      clearTimeout(timer); hideTimer = setTimeout(hide,180);
    }
  });
  document.addEventListener('mouseup', e => {
    if(e.composedPath().includes(root)) return;
    const selection = getSelection();
    const text = selection?.toString().replace(/\s+/g,' ').trim();
    if(!text || text.length < 2 || text.length > 3000) return;
    if (popupMode === 'selection' && text === selectedText) return;
    const article = extractArticle();
    if(!article.isArticle) return;
    const payload = articleRequest(article);
    const index = payload.page_text.indexOf(text);
    if(index < 0) return;
    hide(); popupMode = 'selection'; selectedText = text; selectionOpenedThisGesture = true;
    const run = ++sequence, x=e.clientX,y=e.clientY;
    show(x,y,'<button id="trace-selection">문장 유형·출처 확인</button><p class="trace-note">선택 문장과 기사 본문을 설정된 분석 서버로 전송합니다.</p>');
    shadow.querySelector('#trace-selection').onclick = async () => {
      show(x,y,'<p>선택 문장의 출처를 분석하는 중입니다.</p>');
      try {
        const result = await send('NEWSCHECK_SELECTION',{...payload,selected_text:text,
          surrounding_text:payload.page_text.slice(Math.max(0,index-250),index+text.length+250)});
        if(run === sequence) show(x,y,view.renderSelection(result));
      } catch(error) { if(run === sequence) show(x,y,'<p>' + view.esc(error.message) + '</p>'); }
    };
  });
  // Do not treat the click ending the selecting gesture as an outside dismissal.
  document.addEventListener('mousedown', () => { selectionOpenedThisGesture = false; }, true);
  document.addEventListener('click', e => {
    if (popupMode !== 'selection' || e.composedPath().includes(root)) return;
    if (selectionOpenedThisGesture) { selectionOpenedThisGesture = false; return; }
    hide();
  });
  document.addEventListener('keydown',e => { selectionOpenedThisGesture = false; if(e.key === 'Escape') hide(); });
})();
