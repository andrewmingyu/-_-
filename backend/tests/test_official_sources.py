import asyncio
import io
import json
import zipfile
from types import SimpleNamespace
import pytest
from app.errors import ProviderError
from app.official import Dart, disclosure_rows, find_companies, parse_corps


def corp_zip(items):
    body = '<?xml version="1.0" encoding="UTF-8"?><result>' + ''.join(
        f'<list><corp_code>{c}</corp_code><corp_name>{n}</corp_name><stock_code>{s}</stock_code><modify_date>20260101</modify_date></list>'
        for c, n, s in items) + '</result>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('CORPCODE.xml', body)
    return buffer.getvalue()


ITEMS = [('00126380', '삼성전자', '005930'), ('00164779', 'SK하이닉스', '000660'),
         ('00999999', '비상장회사', ' '), ('00111111', '삼성', '000001'), ('00222222', '가나', '000002')]


def test_parse_corps_keeps_only_listed_companies():
    corps = parse_corps(corp_zip(ITEMS))
    assert corps['삼성전자'] == '00126380' and '비상장회사' not in corps


def test_parse_corps_rejects_garbage():
    with pytest.raises(ProviderError) as caught:
        parse_corps(b'not a zip')
    assert caught.value.code == 'invalid_response'


def test_find_companies_rules():
    corps = parse_corps(corp_zip(ITEMS))
    # 제목에 있으면 선택, 짧은 이름('가나')과 더 긴 이름에 포함된 이름('삼성')은 제외
    assert find_companies('삼성전자 실적 발표', '가나 가나 삼성전자가 밝혔다', corps) == ['삼성전자']
    # 본문에 한 번만 나오면 제외, 두 번 이상이면 선택
    assert find_companies('', 'SK하이닉스가 밝혔다', corps) == []
    assert find_companies('', 'SK하이닉스는 ... SK하이닉스는', corps) == ['SK하이닉스']


def test_disclosure_rows_build_official_urls_and_skip_bad_items():
    rows = disclosure_rows('삼성전자', [
        {'rcept_no': '20260301000123', 'report_nm': '주요사항보고서', 'rcept_dt': '20260301', 'flr_nm': '삼성전자'},
        {'rcept_no': 'bad', 'report_nm': 'x', 'rcept_dt': '20260301'},
        {'rcept_no': '20260302000456', 'report_nm': '', 'rcept_dt': '20260302'}])
    assert len(rows) == 1 and rows[0]['url'] == 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260301000123'
    assert rows[0]['published_date'] == '2026-03-01' and '주요사항보고서' in rows[0]['content']


def patch(monkeypatch, handler):
    async def fake(self, path, params):
        return handler(path, params)
    monkeypatch.setattr(Dart, '_get', fake)


def test_search_without_key_does_nothing(monkeypatch):
    monkeypatch.delenv('DART_API_KEY', raising=False)
    patch(monkeypatch, lambda *a: pytest.fail('must not call the network'))
    assert asyncio.run(Dart().search('삼성전자', '본문')) == []


def test_search_fetches_list_for_matched_company(monkeypatch):
    monkeypatch.setenv('DART_API_KEY', 'demo-key')
    calls = []
    def handler(path, params):
        calls.append((path, params.get('corp_code')))
        if path == 'corpCode.xml':
            return SimpleNamespace(content=corp_zip(ITEMS))
        return SimpleNamespace(json=lambda: {'status': '000', 'list': [
            {'rcept_no': '20260301000123', 'report_nm': '주요사항보고서', 'rcept_dt': '20260301', 'flr_nm': '삼성전자'}]})
    patch(monkeypatch, handler)
    dart = Dart()
    rows = asyncio.run(dart.search('삼성전자 실적', '삼성전자는 ...'))
    assert len(rows) == 1 and calls[0][0] == 'corpCode.xml' and calls[1] == ('list.json', '00126380')
    asyncio.run(dart.search('삼성전자 실적', '삼성전자는 ...'))
    assert [c[0] for c in calls].count('corpCode.xml') == 1  # 상장사 목록은 한 번만 받는다


def test_no_data_and_error_statuses(monkeypatch):
    monkeypatch.setenv('DART_API_KEY', 'demo-key')
    state = {'status': '013'}
    def handler(path, params):
        if path == 'corpCode.xml':
            return SimpleNamespace(content=corp_zip(ITEMS))
        return SimpleNamespace(json=lambda: {'status': state['status'], 'message': 'x'})
    patch(monkeypatch, handler)
    dart = Dart()
    assert asyncio.run(dart.search('삼성전자', '')) == []
    state['status'] = '020'
    with pytest.raises(ProviderError) as caught:
        asyncio.run(dart.search('삼성전자', ''))
    assert caught.value.code == 'rate_limited'


def test_bad_key_xml_error_response(monkeypatch):
    monkeypatch.setenv('DART_API_KEY', 'demo-key')
    patch(monkeypatch, lambda path, params: SimpleNamespace(content=b'<result><status>010</status><message>x</message></result>'))
    with pytest.raises(ProviderError) as caught:
        asyncio.run(Dart().search('삼성전자', ''))
    assert caught.value.code == 'authentication_failed'


def test_analyzer_adds_official_rows_without_breaking_search(monkeypatch):
    import copy
    from app.models import AnalyzeRequest, Article, ArticleContext
    from app.service import Analyzer
    # 같은 폴더의 기존 FakeLLM/FakeSearch 사용(없으면 건너뜀)
    try:
        from test_sources import FakeLLM, FakeSearch, request
    except Exception:
        pytest.skip('test_sources를 불러올 수 없습니다')
    class Official:
        async def search(self, title, text):
            return [{'url': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260301000123', 'title': '정책연구원 - 보고서',
                     'content': '공시', 'raw_content': '공시', 'published_date': '2026-03-01'}]
    result = asyncio.run(Analyzer(FakeLLM(), FakeSearch(), official=Official()).analyze(request()))
    assert any('dart.fss.or.kr' in str(s.url) for s in result.sources)
    class Broken:
        async def search(self, title, text):
            raise ProviderError('rate_limited', 'dart')
    result = asyncio.run(Analyzer(FakeLLM(), FakeSearch(), official=Broken()).analyze(request()))
    assert result.search_status == 'completed'