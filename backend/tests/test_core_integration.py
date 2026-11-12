import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app import main
from app.clients import Gemini, Tavily, provider_failure
from app.errors import ProviderError
from app.models import AnalyzeRequest, Article, ArticleAnalysis, ArticleContext, Extraction
from app.service import Analyzer, body_hash
from test_sources import FakeLLM, FakeSearch, RAW, SOURCE_URL, request

DEMO_TEXT = ('가상정책연구소는 2026년 11월 10일 서울에서 「시연용 정책 검토 자료」를 발표하고 지원제도 개편을 검토 중이라고 밝혔다. '
             '익명 관계자는 “구매 시점이 달라질 수 있다”고 말했다. '
             '시민들은 안내문을 읽고 추가 설명을 기다리고 있다. '
             '향후 별도의 안내가 제공될 예정이다.')


def demo_request():
    return AnalyzeRequest(url='https://n.news.naver.com/mnews/article/001/0000000001',title='지원제도 검토 시연 기사',page_text=DEMO_TEXT,
        metadata=Article(url='https://n.news.naver.com/mnews/article/001/0000000001',publisher='가상신문',author='김가상',published_at='2026-11-11'),
        article_context=ArticleContext(cited_links=[{'url':'https://sources.example/demo-document','text':'시연용 정책 검토 자료'}],quotations=['구매 시점이 달라질 수 있다']))


def test_mock_runs_input_grounding_source_search_and_cautions_without_any_network(monkeypatch):
    async def no_network(*args,**kwargs):
        raise AssertionError('Mock must not call external APIs')
    monkeypatch.setattr(httpx.AsyncClient,'post',no_network)
    analyzer=Analyzer(Gemini(),Tavily(),mode='mock')
    result=asyncio.run(analyzer.analyze(demo_request()))
    assert result.is_demo and result.article.url == demo_request().url
    assert result.body_hash == body_hash(DEMO_TEXT)
    assert result.article.event_time == '2026년 11월 10일' and result.article.event_location == '서울'
    assert result.sources[0].original_status == 'original_found'
    assert result.sources[0].facts.authorship.excerpt == '작성자: 가상자료팀'
    assert result.context_timeline[0].source_ids == [result.sources[0].id]
    assert any(d.source_ids for d in result.caution.details)
    for claim in result.claims:
        assert DEMO_TEXT[claim.article_span.start:claim.article_span.end] == claim.original_text
    assert result.section_states['evidence'].status == 'ready'
    changed=demo_request().model_copy(update={'page_text':'공원이 오늘 개방되었다. 시민들이 공원을 이용하고 있다.'})
    other=asyncio.run(analyzer.analyze(changed))
    assert other.article_id != result.article_id and other.body_hash != result.body_hash
    assert other.claims[0].original_text == '공원이 오늘 개방되었다.'
    assert not other.sources


def test_cached_lookup_preview_and_focused_selection_share_parent_result(monkeypatch):
    analyzer=Analyzer(None,None,mode='mock')
    monkeypatch.setattr(main,'analyzer',analyzer)
    with TestClient(main.app) as client:
        assert client.get('/api/articles/missing').status_code == 404
        payload=demo_request().model_dump(mode='json')
        result=client.post('/api/articles/analyze',json=payload).json()
        lookup=client.get('/api/articles/'+result['article_id'],params={'url':payload['url']})
        assert lookup.status_code==200 and lookup.json()==result
        assert client.get('/api/articles/'+result['article_id'],params={'url':'https://other.example/'}).status_code==404
        preview=client.post('/api/preview',json=payload).json()
        assert preview['claims'] and preview['body_hash']==result['body_hash']
        assert preview['article_id']==result['article_id']
        selected='향후 별도의 안내가 제공될 예정이다.'
        focused=client.post('/api/claims/check',json={**payload,'selected_text':selected,'article_id':result['article_id']}).json()
        assert focused['claims'][0]['original_text']==selected and focused['article_id']==result['article_id']
        assert focused['analysis_id']!=result['article_id'] and not focused['matched_claim_ids']
        assert focused['claims'][0]['id'] not in {c['id'] for c in result['claims']}
        assert client.get('/api/articles/'+result['article_id']).json()==result
        key=analyzer.cache_key(demo_request())
        analyzer.cache[key]=(0,analyzer.cache[key][1])
        assert client.get('/api/articles/'+result['article_id']).status_code==404


def test_tracking_parameters_do_not_split_the_same_body_metadata_cache():
    async def scenario():
        analyzer=Analyzer(FakeLLM(),FakeSearch())
        first=request()
        tracking_url=str(first.url)+'?utm_source=test#anchor'
        tracked=AnalyzeRequest.model_validate({**first.model_dump(mode='json'),'url':tracking_url,
            'metadata':{**first.metadata.model_dump(mode='json'),'url':tracking_url}})
        a=await analyzer.analyze(first)
        b=await analyzer.analyze(tracked)
        assert a.article_id==b.article_id and analyzer.llm.calls==2
    asyncio.run(scenario())


def test_no_source_search_needed_still_reuses_article_result():
    async def scenario():
        analyzer = Analyzer(None, None, mode='mock')
        payload = demo_request().model_copy(update={
            'title': '공원 개방 기사', 'page_text': '공원이 오늘 개방되었다. 시민들이 공원을 이용하고 있다.',
            'article_context': ArticleContext(),
        })
        calls = 0
        generate = analyzer.llm.generate
        async def counted(*args, **kwargs):
            nonlocal calls
            calls += 1
            return await generate(*args, **kwargs)
        analyzer.llm.generate = counted
        first = await analyzer.analyze(payload)
        second = await analyzer.analyze(payload)
        assert first.search_status == 'not_run' and not first.search_errors
        assert any('검색을 실행하지 않았습니다' in reason for reason in first.caution.reasons)
        assert not any('실패' in reason for reason in first.caution.reasons)
        assert calls == 1 and second.analyzed_at == first.analyzed_at
        assert analyzer.lookup(first.article_id) is not None
        await analyzer.analyze(payload.model_copy(update={'page_text': payload.page_text + ' 운영 시간은 별도로 안내한다.'}))
        assert calls == 2
    asyncio.run(scenario())


def test_lookup_validates_url_before_searching_empty_or_populated_cache(monkeypatch):
    analyzer = Analyzer(None, None, mode='mock')
    monkeypatch.setattr(main, 'analyzer', analyzer)
    with TestClient(main.app) as client:
        assert client.get('/api/articles/missing', params={'url': 'javascript:invalid'}).status_code == 422
        result = client.post('/api/articles/analyze', json=demo_request().model_dump(mode='json')).json()
        assert client.get('/api/articles/'+result['article_id'], params={'url': 'javascript:invalid'}).status_code == 422
        assert client.get('/api/articles/missing', params={'url': 'https://news.example/1'}).status_code == 404


class SnippetSearch(FakeSearch):
    def __init__(self,fail=False):
        super().__init__(rows=[{'url':SOURCE_URL,'title':'지원 검토 보고서','content':RAW,'published_date':'2026-11-10'}])
        self.fail_extract=fail
        self.extracted=[]
    async def extract(self,urls):
        self.extracted=urls
        if self.fail_extract:
            raise ProviderError('rate_limited','tavily',17)
        return [{'url':'https://invented.example/doc','raw_content':RAW},{'url':SOURCE_URL,'raw_content':RAW}]


def test_search_only_urls_can_be_enriched_with_real_document_content():
    search=SnippetSearch()
    result=asyncio.run(Analyzer(FakeLLM(),search).analyze(request()))
    assert search.extracted==[SOURCE_URL]
    assert [str(s.url) for s in result.sources]==[SOURCE_URL]
    assert result.sources[0].content_status=='retrieved'
    assert result.sources[0].original_status=='original_found'


def test_document_rate_limit_is_not_search_not_found_and_keeps_retry_hint():
    result=asyncio.run(Analyzer(FakeLLM(),SnippetSearch(fail=True)).analyze(request()))
    assert result.search_status=='completed' and result.claims[0].source_status=='unknown'
    assert result.sources[0].content_status=='unavailable'
    assert result.pipeline_errors[0].phase=='document_fetch'
    assert result.pipeline_errors[0].code=='rate_limited' and result.pipeline_errors[0].retry_after_seconds==17
    assert result.section_states['evidence'].status=='error'


def test_caution_details_cannot_reference_unretrieved_sources():
    result=asyncio.run(Analyzer(None,None,mode='mock').analyze(demo_request())).model_dump(mode='json')
    result['caution']['details'].append({'reason':'허구 연결','source_ids':['made-up'],'claim_ids':[]})
    with pytest.raises(ValidationError):ArticleAnalysis.model_validate(result)


def test_missing_live_keys_returns_configuration_error_without_fake_success(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY',raising=False);monkeypatch.delenv('LLM_MODEL',raising=False)
    monkeypatch.setattr(main,'analyzer',Analyzer(Gemini(),Tavily(),mode='live'))
    with TestClient(main.app) as client:
        response=client.post('/api/articles/analyze',json=demo_request().model_dump(mode='json'))
    assert response.status_code==503 and response.json()['error']['code']=='configuration_missing'
    assert 'claims' not in response.json()


@pytest.mark.parametrize('code,status',[('rate_limited',429),('timeout',504),('invalid_response',502)])
def test_global_provider_error_status_and_retry_header(monkeypatch,code,status):
    class Failure:
        async def generate(self,*args):raise ProviderError(code,'gemini',13 if code=='rate_limited' else None)
    monkeypatch.setattr(main,'analyzer',Analyzer(Failure(),FakeSearch()))
    with TestClient(main.app) as client:
        response=client.post('/api/articles/analyze',json=request().model_dump(mode='json'))
    assert response.status_code==status and response.json()['error']['code']==code
    if code=='rate_limited':assert response.headers['Retry-After']=='13'


def test_related_news_reuses_press_names_and_never_invents_comparisons():
    class NewsSearch(FakeSearch):
        async def search(self,query,topic='general'):
            if topic=='news':return [
                {'url':'https://www.chosun.com/news/1','title':'보도 하나','content':'첫 보도 검색 요약'},
                {'url':'https://m.chosun.com/news/2','title':'같은 발행자 보도','content':'중복 발행자'},
                {'url':'https://www.hani.co.kr/news/3','title':'다른 발행자','content':'다른 보도 검색 요약'}]
            return await super().search(query,topic)
    result=asyncio.run(Analyzer(FakeLLM(),NewsSearch()).analyze(request()))
    assert [r.publisher for r in result.related_articles]==['조선일보','한겨레']
    assert result.related_articles[0].summary=='첫 보도 검색 요약'
    assert result.related_articles[0].topic==request().title
    assert all('확인하지 못했습니다' in r.independence for r in result.related_articles)


@pytest.mark.parametrize('case,code',[('rate','rate_limited'),('timeout','timeout'),('format','invalid_response'),('network','network_error')])
def test_tavily_failure_categories_are_distinct_without_external_requests(monkeypatch,case,code):
    original=httpx.AsyncClient
    def handler(req):
        if case=='rate':return httpx.Response(429,headers={'Retry-After':'12'},json={'error':'dummy'})
        if case=='timeout':raise httpx.ReadTimeout('dummy private data',request=req)
        if case=='network':raise httpx.ConnectError('dummy private data',request=req)
        return httpx.Response(200,json={'unexpected':[]})
    monkeypatch.setenv('TAVILY_API_KEY','demo-test-key')
    monkeypatch.setattr('app.clients.httpx.AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))
    with pytest.raises(ProviderError) as caught:asyncio.run(Tavily().search('query'))
    assert caught.value.code==code and 'private' not in caught.value.message
    if case=='rate':assert caught.value.retry_after_seconds==12


def test_gemini_sdk_structured_config_path_without_network(monkeypatch):
    from google import genai
    captured={}
    class FakeAsync:
        models=None
        def __init__(self):self.models=self
        async def __aenter__(self):return self
        async def __aexit__(self,*args):return False
        async def generate_content(self,**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(text=json.dumps({'summary':'시연','claims':[],'evidence_mentions':[],'headline_difference':'미확인'}))
    monkeypatch.setenv('GEMINI_API_KEY','demo-test-key');monkeypatch.setenv('LLM_MODEL','demo-model')
    def client(**kwargs):
        captured['client_options'] = kwargs['http_options']
        return SimpleNamespace(aio=FakeAsync())
    monkeypatch.setattr(genai,'Client',client)
    result=asyncio.run(Gemini().generate('instruction',{'body':'본문'},Extraction))
    assert result.summary=='시연'
    assert captured['config'].response_mime_type=='application/json'
    assert captured['config'].response_json_schema['properties']['claims']
    assert captured['client_options']['retry_options']['attempts'] == 1


def test_gemini_permission_failure_has_actionable_code_without_provider_secrets(monkeypatch):
    from google.genai.errors import ClientError
    error = provider_failure(ClientError(403, {'error': {'status': 'PERMISSION_DENIED',
        'message': 'sensitive-provider-key-and-request'}}), 'gemini')
    class FailingAnalyzer:
        async def analyze(self, request):
            raise error
    monkeypatch.setattr(main, 'analyzer', FailingAnalyzer())
    with TestClient(main.app) as client:
        response = client.post('/api/articles/analyze', json=request().model_dump(mode='json'))
        assert response.status_code == 502
        assert response.json()['error']['code'] == 'permission_denied'
        assert 'sensitive-provider' not in response.text and 'PERMISSION_DENIED' not in response.text


def test_upstream_service_outage_is_distinct_and_preserves_safe_retry_header(monkeypatch):
    response = httpx.Response(503, request=httpx.Request('POST', 'https://provider.example/'),
                              headers={'Retry-After': '23'})
    raw = httpx.HTTPStatusError('sensitive-request-content', request=response.request, response=response)
    error = provider_failure(raw, 'gemini')
    class FailingAnalyzer:
        async def analyze(self, request):
            raise error
    monkeypatch.setattr(main, 'analyzer', FailingAnalyzer())
    with TestClient(main.app) as client:
        response = client.post('/api/articles/analyze', json=request().model_dump(mode='json'))
        assert response.status_code == 503 and response.headers['Retry-After'] == '23'
        assert response.json()['error']['code'] == 'provider_unavailable'
        assert 'sensitive-request-content' not in response.text
