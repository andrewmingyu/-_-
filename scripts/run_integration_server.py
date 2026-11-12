"""Mock-only real HTTP test server, stopped through stdin rather than a product API."""
import os
import sys
import threading
from pathlib import Path
import uvicorn

if os.getenv('ANALYSIS_MODE') != 'mock':
    raise RuntimeError('Integration server requires explicit mock mode')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.main import app

server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=int(sys.argv[1]), log_level='error'))
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
try:
    for line in sys.stdin:
        if line.strip() == 'stop':
            break
finally:
    server.should_exit = True
    thread.join(timeout=10)
