"""Real HTTP smoke test in mock mode; does not call Gemini/Tavily."""
import json
import socket
import sys
import threading
import time
from pathlib import Path
import httpx
import uvicorn
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app import main
from app.clients import Gemini, Tavily
from app.service import Analyzer
main.analyzer=Analyzer(Gemini(),Tavily(),mode='mock')
fixture=json.loads((ROOT/'newscheck 4/data/demo.json').read_text(encoding='utf-8'))
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
server=uvicorn.Server(uvicorn.Config(main.app,log_level='error'))
thread=threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
try:
    for _ in range(100):
        if server.started: break
        time.sleep(0.05)
    assert server.started
    payload={'url':fixture['article']['url'],'title':fixture['article']['title'],
             'page_text':' '.join(c['original_text'] for c in fixture['claims'])}
    with httpx.Client(base_url=f'http://127.0.0.1:{port}') as client:
        assert client.get('/health').json()['mode']=='mock'
        full=client.post('/api/articles/analyze',json=payload);full.raise_for_status()
        preview=client.post('/api/preview',json=payload);preview.raise_for_status()
        selected=client.post('/api/claims/check',json={**payload,'article_id':full.json()['article_id'],
            'selected_text':fixture['claims'][0]['original_text']});selected.raise_for_status()
        assert full.json()['is_demo'] and preview.json()['is_demo'] and selected.json()['is_demo']
        assert full.json()['article_id']==preview.json()['article_id']==selected.json()['article_id']
        assert full.json()['sources']==selected.json()['sources']
    print('Real HTTP mock smoke: health, article, Hover preview and selected sentence passed.')
finally:
    server.should_exit=True;thread.join(timeout=10);sock.close()
