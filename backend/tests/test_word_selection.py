import asyncio
import pytest
from fastapi.testclient import TestClient
from app import main
from app.models import WordRequest,WordDraft,SelectionRequest
from app.words import WordExplainer
from app.service import Analyzer,ArticleInputError

TEXT='협상이 실패하면 벼랑 끝에 몰릴 수 있다는 비유다.'
def request(**kwargs):
    return WordRequest(url='https://www.chosun.com/site/data/html_dir/2018/03/12/2018031200322.html',
        page_text=TEXT,surrounding_text=TEXT,selected_text='벼랑',context_scope='page_excerpt',**kwargs)
class Search:
    def __init__(self,fail=False,snippet=False):self.calls=0;self.fail=fail;self.snippet=snippet
    async def search_dictionary(self,term):
        self.calls+=1
        if self.fail:raise RuntimeError('private provider detail')
        return [{'url':'https://krdict.korean.go.kr/kor/entry/fixture','title':'벼랑 · 합성 사전 자료',
            'content':'벼랑은 가파르게 깎아지른 낭떠러지이다.','raw_content':'' if self.snippet else '벼랑은 가파르게 깎아지른 낭떠러지이다.'}]
class LLM:
    def __init__(self,invalid=False):self.calls=0;self.invalid=invalid
    async def generate(self,instruction,payload,schema):
        self.calls+=1
        sources=payload['dictionary_sources']
        return WordDraft(lemma='벼랑',general_meaning='낭떠러지를 뜻하는 말이다.',contextual_meaning='위태로운 상황을 비유한다.',
            context_quote='없는 인용' if self.invalid else TEXT,
            dictionary_source_id='invented' if self.invalid else sources[0]['id'] if sources else None,
            dictionary_quote='가짜 인용' if self.invalid else '가파르게 깎아지른 낭떠러지',dictionary_meaning='가파른 낭떠러지')

def test_dictionary_identity_exact_quotes_context_and_cache():
    async def run():
        search,llm=Search(),LLM();words=WordExplainer(llm,search)
        first,second=await asyncio.gather(words.explain(request()),words.explain(request()))
        assert first.dictionary_status=='found' and first.context_quote==TEXT
        assert first.dictionary_sources[0].excerpt=='가파르게 깎아지른 낭떠러지'
        assert search.calls==llm.calls==1
        first.dictionary_sources.clear()
        assert (await words.explain(request())).dictionary_sources
        await words.explain(request(refresh=True));assert llm.calls==2
    asyncio.run(run())

def test_hallucinated_dictionary_ids_and_context_quotes_are_not_displayed():
    result=asyncio.run(WordExplainer(LLM(True),Search()).explain(request()))
    assert result.dictionary_status=='not_found' and not result.dictionary_sources and not result.dictionary_meaning
    assert not result.contextual_meaning and not result.context_quote
    assert result.pipeline_errors[0].phase=='dictionary_reference'

def test_real_dictionary_id_with_invented_quote_is_also_rejected():
    class WrongQuote(LLM):
        async def generate(self,instruction,payload,schema):
            draft=await super().generate(instruction,payload,schema)
            draft.dictionary_quote='실제 사전 자료에 없는 인용문'
            return draft
    result=asyncio.run(WordExplainer(WrongQuote(),Search()).explain(request()))
    assert not result.dictionary_sources and not result.dictionary_meaning
    assert result.contextual_meaning and result.context_quote==TEXT

def test_dictionary_search_failure_and_search_snippets_are_distinct():
    failed=asyncio.run(WordExplainer(LLM(),Search(True)).explain(request()))
    assert failed.dictionary_status=='failed' and failed.general_meaning
    assert 'private' not in failed.model_dump_json()
    snippet=asyncio.run(WordExplainer(LLM(),Search(snippet=True)).explain(request()))
    assert snippet.dictionary_status=='search_only' and snippet.dictionary_sources[0].basis=='search_snippet'

def test_unrelated_hosts_and_missing_selection_are_rejected():
    class Other(Search):
        async def search_dictionary(self,term):return [{'url':'https://evil.example/entry','raw_content':'벼랑 뜻풀이'}]
    result=asyncio.run(WordExplainer(LLM(),Other()).explain(request()))
    assert result.dictionary_status=='not_found' and not result.dictionary_sources
    with pytest.raises(ArticleInputError):asyncio.run(WordExplainer(LLM(),Search()).explain(request().model_copy(update={'page_text':'다른 문장'})))

def test_mock_word_api_and_page_excerpt_do_not_create_a_whole_article_cache(monkeypatch):
    analyzer=Analyzer(None,None,mode='mock');monkeypatch.setattr(main,'analyzer',analyzer)
    with TestClient(main.app) as client:
        response=client.post('/api/words/explain',json=request().model_dump(mode='json'))
        assert response.status_code==200
        word=response.json();assert word['is_demo'] and word['dictionary_status']=='not_found' and '시연' in word['general_meaning']
        assert not analyzer.cache
        selection=client.post('/api/claims/check',json={'url':'https://generic.example/page','title':'일반 페이지',
            'page_text':TEXT,'selected_text':TEXT,'context_scope':'page_excerpt'})
        assert selection.status_code==200 and selection.json()['context_scope']=='page_excerpt'
        assert selection.json()['selected_text']==TEXT and selection.json()['claims']
        assert analyzer.lookup(selection.json()['article_id']).headline_explanation.reasons==[]
        assert analyzer.lookup(selection.json()['article_id']).article_context.body_truncated
        assert client.post('/api/words/explain',json={'url':'https://generic.example','page_text':'핵 관련 문맥을 확인한다.',
            'selected_text':'핵','context_scope':'page_excerpt'}).status_code==200
        assert client.post('/api/words/explain',json={**request().model_dump(mode='json'),'selected_text':'두 단어'}).status_code==422
