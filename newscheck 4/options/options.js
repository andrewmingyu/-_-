import { backendUrl } from '../shared/api.js';
const input = document.getElementById('backendUrl');
const status = document.getElementById('saved');
chrome.storage.local.get('backendUrl').then(s => { input.value = s.backendUrl || 'http://127.0.0.1:8000'; });
document.getElementById('save').addEventListener('click', async () => {
  try {
    const url = backendUrl(input.value.trim());
    const permissionUrl = new URL(url);
    permissionUrl.port = '';
    if (!await chrome.permissions.request({ origins: [permissionUrl.origin + '/*'] })) throw new Error('서버 접속 권한이 필요합니다.');
    await chrome.storage.local.set({ backendUrl: url });
    status.textContent = '저장됨';
  } catch (e) { status.textContent = e.message; }
  status.hidden = false;
});
document.getElementById('clear-legacy').addEventListener('click', async () => {
  await chrome.storage.local.remove(['provider', 'apiKey', 'model', 'naverId', 'naverSecret']);
  status.hidden = false; status.textContent = '이전 브라우저 API 키 설정을 삭제했습니다.';
});
