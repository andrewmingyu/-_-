import asyncio
import copy
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app import main
from app.models import (AnalyzeRequest, Article, ArticleAnalysis, Extraction, SourceFacts, SourceReviews,
                        SelectionRequest, Claim, Decision)
from app.service import Analyzer, body_hash, combine_decisions, source_decision

TEXT = '정책연구원은 「지원 검토 보고서」에서 제도 개편을 검토하고 있다고 밝혔다.'
URL = 'https://news.example/article/1'
SOURCE_URL = 'https://policy.example/report'
RAW = '정책연구원 직접 발간 지원 검토 보고서. 작성자 자료팀. 조사기간 2026년. 전수조사. 공개 원문. 이해관계 없음. 독립 수집. 정책 전문기관. 직접 조사.'


class FakeLLM:
    def __init__(self, original='original_found', bad_id=False, bad_excerpt=False):
        self.calls = 0
        self.original, self.bad_id, self.bad_excerpt = original, bad_id, bad_excerpt

    async def generate(self, instruction, payload, schema):
        self.calls += 1
        if schema is Extraction:
            await asyncio.sleep(0.001)
            text = payload.get('selected_text') or payload['body']
            return Extraction(summary='제도 개편 검토를 다루는 기사입니다.', headline_difference='제목·본문의 표현을 정리했습니다.',
                claims=[Claim(id='c1', original_text=text, claim_text='확정으로 바꾸면 안 됨', claim_type='quotation', speaker='없는 사람')],
                evidence_mentions=[{'id':'m1','claim_ids':['c1'],'description':'보고서', 'article_quote':text,
                    'source_label':'정책연구원','document_title':'지원 검토 보고서','source_kind':'research'}])
        source_id = 'invented' if self.bad_id else payload['sources'][0]['id']
        excerpts = {'identity':'정책연구원', 'authorship':'작성자 자료팀', 'originality':'직접 발간', 'expertise':'정책 전문기관',
            'information_access':'직접 조사', 'date_context':'조사기간 2026년', 'public_access':'공개 원문',
            'methodology':'전수조사', 'interests':'이해관계 없음', 'independence':'독립 수집'}
        facts = {key:{'excerpt':'없는 원문' if self.bad_excerpt else value} for key,value in excerpts.items()}
        return SourceReviews(sources=[{'source_id':source_id,'mention_ids':['m1'],'original_status':self.original,'facts':facts}])


class FakeSearch:
    def __init__(self, rows=None, fail=False):
        self.calls = 0
        self.rows = rows if rows is not None else [{'url':SOURCE_URL,'title':'지원 검토 보고서', 'raw_content':RAW, 'content':'검색 요약', 'published_date':'2026-11-10'}]
        self.fail = fail

    async def search(self, query, topic='general'):
        if topic == 'news':
            return []
        self.calls += 1
        if self.fail:
            raise RuntimeError('provider failure with secret must never be exposed')
        return copy.deepcopy(self.rows)


def request(**extra):
    return AnalyzeRequest(url=URL, title='제도 개편 검토', page_text=TEXT,
        metadata=Article(url=URL,title='제도 개편 검토',published_at='2026-11-11'), **extra)


def run(analyzer, req=None):
    return asyncio.run(analyzer.analyze(req or request()))


def test_original_and_caution_absence_do_not_produce_a_truth_verdict():
    a = run(Analyzer(FakeLLM(),FakeSearch()))
    assert a.claims[0].source_status == 'original_found'
    assert a.caution.status == 'none_identified'
    assert '진위' in a.caution.reasons[0]
    assert a.claims[0].claim_text == TEXT and a.claims[0].speaker is None
    assert a.sources[0].discovery == 'article_cited'
    forbidden = {'verification_status','relation_to_claim','score','probability','credibility'}
    def check(obj):
        if isinstance(obj,dict):
            assert not forbidden.intersection(obj)
            for value in obj.values(): check(value)
        if isinstance(obj,list):
            for value in obj: check(value)
    check(a.model_dump())


def test_no_results_and_search_failure_are_different():
    empty = run(Analyzer(FakeLLM(), FakeSearch(rows=[])))
    failure = run(Analyzer(FakeLLM(), FakeSearch(fail=True)))
    assert empty.search_status == 'completed'
    assert empty.claims[0].source_status == 'source_not_found'
    assert empty.caution.status == 'caution'
    assert failure.search_status == 'failed'
    assert failure.claims[0].source_status == 'unknown'
    assert failure.caution.status == 'unknown'
    assert 'secret' not in json.dumps(failure.model_dump(),default=str)


@pytest.mark.parametrize('bad_id,bad_excerpt',[(True,False),(False,True)])
def test_hallucinated_ids_and_unretrieved_observations_cannot_confirm_original(bad_id,bad_excerpt):
    a=run(Analyzer(FakeLLM(bad_id=bad_id,bad_excerpt=bad_excerpt),FakeSearch()))
    assert [str(s.url) for s in a.sources] == [SOURCE_URL]
    assert a.sources[0].original_status == 'unknown'
    assert a.sources[0].facts.identity is None
    assert a.sources[0].discovery == ('external_found' if bad_id else 'article_cited')
    assert a.claims[0].source_status != 'original_found'


def test_secondary_only_has_objective_caution_without_refuting_claim():
    a=run(Analyzer(FakeLLM(original='secondary_only'),FakeSearch()))
    assert a.claims[0].source_status == 'secondary_only'
    assert a.claims[0].caution.status == 'caution'
    assert any('재인용' in r for r in a.claims[0].caution.reasons)


def test_search_snippet_alone_does_not_confirm_original():
    a=run(Analyzer(FakeLLM(),FakeSearch(rows=[{'url':SOURCE_URL,'title':'지원 검토 보고서','content':RAW}])))
    assert a.sources[0].original_status == 'unknown'
    assert a.sources[0].facts.identity is None


def test_original_claims_and_mentions_must_be_anchored_in_article():
    raw=Extraction(summary='요약',headline_difference='미확인',claims=[Claim(id='c1',original_text='원문에 없음',claim_text='생성',claim_type='factual_narration')],
        evidence_mentions=[{'id':'m1','claim_ids':['c1'],'description':'허구','article_quote':'기사에 없음'}])
    cleaned=Analyzer.clean_extraction(raw,TEXT)
    assert cleaned.claims == [] and cleaned.evidence_mentions == []


def test_citation_relationship_is_not_created_from_topic_similarity():
    search=FakeSearch(rows=[{'url':SOURCE_URL,'title':'다른 보고서','raw_content':'다른 기관의 관련 자료'}])
    a=run(Analyzer(FakeLLM(),search))
    assert a.sources[0].discovery == 'external_found'
    assert a.claims[0].source_ids == []


def test_same_institution_different_document_is_external_not_article_cited():
    search=FakeSearch(rows=[{'url':SOURCE_URL,'title':'다른 보고서','raw_content':'정책연구원 직접 발간 다른 보고서'}])
    a=run(Analyzer(FakeLLM(),search))
    assert a.sources[0].discovery == 'external_found'
    assert a.sources[0].mention_ids == []


def test_uncached_sentence_keeps_article_context_and_does_not_replace_article():
    async def scenario():
        analyzer=Analyzer(FakeLLM(),FakeSearch())
        req=request().model_copy(update={'page_text':TEXT+' 다른 발언도 있다.'})
        full=await analyzer.analyze(req)
        # Make article extraction omit the later sentence, as a real top-3 extractor would.
        key=analyzer.cache_key(req)
        analyzer.cache[key][1].claims[0].original_text=TEXT
        selected=await analyzer.selection(SelectionRequest(**req.model_dump(),selected_text='다른 발언도 있다.'))
        assert selected.claims[0].original_text == '다른 발언도 있다.'
        assert selected.article_id == full.article_id
        assert (await analyzer.analyze(req)).claims[0].original_text == TEXT
    asyncio.run(scenario())


def test_interest_missing_method_and_age_produce_descriptive_caution_only():
    facts=SourceFacts(interests={'excerpt':'이 연구는 판매업체가 연구비를 지원했다.'})
    decision,missing=source_decision('original_found',facts,'research','2020-01-01','2026-11-11')
    assert decision.status == 'caution'
    assert len(decision.reasons) == 3
    assert '조사 방법' in missing


def test_unknown_dates_cannot_be_silently_treated_as_no_caution():
    facts=SourceFacts(**{key:{'excerpt':'이해관계 없음' if key == 'interests' else '명시된 정보'} for key in SourceFacts.model_fields})
    decision,missing=source_decision('original_found',facts,'research')
    assert decision.status == 'unknown'
    assert '자료 발행일' in missing and '기사 작성일' in missing


def test_cache_shared_and_content_change_and_refresh_reanalyze():
    async def scenario():
        llm,search=FakeLLM(),FakeSearch()
        analyzer=Analyzer(llm,search)
        first,second=await asyncio.gather(analyzer.analyze(request()),analyzer.analyze(request()))
        assert first.article_id == second.article_id and llm.calls == 2
        await analyzer.analyze(request())
        assert llm.calls == 2
        await analyzer.analyze(request(refresh=True))
        assert llm.calls == 4
        changed=request().model_copy(update={'page_text':TEXT+' 추후 발표 예정이다.'})
        assert (await analyzer.analyze(changed)).article_id != first.article_id
    asyncio.run(scenario())


def test_failed_search_is_retryable_not_cached():
    async def scenario():
        search=FakeSearch(fail=True)
        analyzer=Analyzer(FakeLLM(),search)
        await analyzer.analyze(request())
        search.fail=False
        a=await analyzer.analyze(request())
        assert search.calls == 2 and a.search_status == 'completed'
    asyncio.run(scenario())


def test_cache_expiration_capacity_and_returned_copy_are_enforced():
    async def scenario():
        llm=FakeLLM()
        analyzer=Analyzer(llm,FakeSearch())
        first=await analyzer.analyze(request())
        first.claims.clear()
        assert (await analyzer.analyze(request())).claims
        key=analyzer.cache_key(request())
        analyzer.cache[key]=(0,analyzer.cache[key][1])
        await analyzer.analyze(request())
        assert llm.calls == 4
        mock=Analyzer(None,None,mode='mock')
        initial=None
        for i in range(129):
            req=request().model_copy(update={'title':f'article {i}'})
            if i == 0: initial=mock.cache_key(req)
            await mock.analyze(req)
        assert len(mock.cache) == 128 and initial not in mock.cache
    asyncio.run(scenario())


def test_unknown_fields_and_old_truth_fields_are_rejected():
    fixture=Path(__file__).resolve().parents[2]/'newscheck 4/data/demo.json'
    data=json.loads(fixture.read_text(encoding='utf-8'))
    assert ArticleAnalysis.model_validate(data).is_demo
    data['claims'][0]['verification_status']='supports'
    with pytest.raises(ValidationError): ArticleAnalysis.model_validate(data)
    with pytest.raises(ValidationError): Decision(status='none_identified',reasons=[])
    with pytest.raises(ValidationError): Decision(status='none_identified',reasons=['   '])


def test_schema_snapshot_agrees_with_runtime_models():
    import importlib.util
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('export_schema',root/'scripts/export_schema.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert json.loads((root/'docs/api.schema.json').read_text(encoding='utf-8')) == module.schemas()


def test_http_endpoints_share_result_and_selection_reuses_claim(monkeypatch):
    analyzer=Analyzer(FakeLLM(),FakeSearch())
    monkeypatch.setattr(main,'analyzer',analyzer)
    with TestClient(main.app) as client:
        payload=request().model_dump(mode='json')
        full=client.post('/api/articles/analyze',json=payload)
        assert full.status_code == 200
        preview=client.post('/api/preview',json=payload)
        assert preview.status_code == 200
        assert preview.json()['article_id'] == full.json()['article_id']
        selection=client.post('/api/claims/check',json={**payload,'article_id':full.json()['article_id'],'selected_text':TEXT})
        assert selection.status_code == 200
        assert selection.json()['sources'] == full.json()['sources']
        assert analyzer.llm.calls == 2
        assert client.post('/api/claims/check',json={**payload,'selected_text':'없는 문장'}).status_code == 422
        assert client.post('/api/claims/check',json={**payload,'article_id':'old','selected_text':TEXT}).status_code == 422
        assert client.post('/api/preview',json={'url':URL,'title':'제목만'}).status_code == 422
        assert client.get('/health').json()['schema_version'] == 'source-tracing-v1'
        schema=client.get('/openapi.json').json()
        assert 'verification_status' not in json.dumps(schema)


def test_provider_value_errors_are_gateway_errors_without_internal_details(monkeypatch):
    class BrokenLLM:
        async def generate(self, *args):
            raise ValueError('malformed provider payload with secret')
    monkeypatch.setattr(main, 'analyzer', Analyzer(BrokenLLM(), FakeSearch()))
    with TestClient(main.app) as client:
        for endpoint, extra in [('/api/articles/analyze', {}), ('/api/preview', {}),
                                ('/api/claims/check', {'selected_text': TEXT})]:
            response = client.post(endpoint, json={**request().model_dump(mode='json'), **extra})
            assert response.status_code == 502
            assert 'secret' not in response.text and 'malformed' not in response.text
