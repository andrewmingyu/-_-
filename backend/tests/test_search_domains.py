import asyncio
import pytest
from app.clients import Tavily


@pytest.fixture
def captured(monkeypatch):
    calls = []
    async def fake(self, endpoint, payload):
        calls.append(payload)
        return []
    monkeypatch.setattr(Tavily, '_request', fake)
    return calls


def test_default_depth_and_news_stays_basic(monkeypatch, captured):
    monkeypatch.delenv('TAVILY_SEARCH_DEPTH', raising=False)
    asyncio.run(Tavily().search('q'))
    asyncio.run(Tavily().search('q', topic='news'))
    assert [c['search_depth'] for c in captured] == ['advanced', 'basic']


def test_depth_can_be_lowered(monkeypatch, captured):
    monkeypatch.setenv('TAVILY_SEARCH_DEPTH', 'basic')
    asyncio.run(Tavily().search('q'))
    assert captured[0]['search_depth'] == 'basic'


def test_search_in_uses_include_domains(monkeypatch, captured):
    monkeypatch.delenv('SEARCH_EXTRA_DOMAINS', raising=False)
    asyncio.run(Tavily().search_in('q'))
    assert captured[0]['include_domains'][0] == 'korea.kr' and 'youtube.com' in captured[0]['include_domains']


def test_search_in_ignores_bad_domains_and_can_be_off(monkeypatch, captured):
    monkeypatch.setenv('SEARCH_EXTRA_DOMAINS', 'youtube.com, bad domain!, https://x.com/path')
    asyncio.run(Tavily().search_in('q'))
    assert captured[0]['include_domains'] == ['youtube.com']
    monkeypatch.setenv('SEARCH_EXTRA_DOMAINS', 'off')
    assert asyncio.run(Tavily().search_in('q')) == [] and len(captured) == 1


def test_search_is_logged_without_long_query_or_keys(monkeypatch, caplog):
    import logging
    async def fake(self, endpoint, payload):
        return [{'url': 'https://www.youtube.com/watch?v=1'}, {'url': 'https://news.go.kr/a'}]
    monkeypatch.setattr(Tavily, '_request', fake)
    monkeypatch.setenv('TAVILY_API_KEY', 'demo-secret-key')
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        asyncio.run(Tavily().search('가' * 100))
    text = caplog.text
    assert 'www.youtube.com' in text and 'news.go.kr' in text and '2건' in text
    assert '가' * 41 not in text and 'demo-secret-key' not in text
    monkeypatch.setenv('SEARCH_LOG', 'off')
    caplog.clear()
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        asyncio.run(Tavily().search('q'))
    assert 'Tavily' not in caplog.text