import asyncio
from app.models import AnalyzeRequest
from app.mock import MockLLM
from app.service import Analyzer

TEXT='정책연구원은 지원제도 개편을 검토한다고 밝혔다. 세부 시행 시점은 아직 정해지지 않았다.'


class CountedLLM:
    def __init__(self):
        self.calls=0
        self.mock=MockLLM()

    async def generate(self,*args):
        self.calls+=1
        await asyncio.sleep(0)
        return await self.mock.generate(*args)


class Search:
    def __init__(self):
        self.calls=0

    async def search(self,query,topic='general'):
        self.calls+=1
        return []


def request():
    return AnalyzeRequest(url='https://news.example/article/1',title='지원제도 개편 검토',page_text=TEXT)


def test_cold_preview_only_extracts_then_panel_reuses_it_without_pretending_full_analysis_exists():
    async def scenario():
        llm,search=CountedLLM(),Search()
        analyzer=Analyzer(llm,search)
        first,second=await asyncio.gather(analyzer.preview(request()),analyzer.preview(request()))
        assert first.summary and first.article_id==second.article_id
        assert first.search_status=='not_run'
        assert first.sources==[] and first.major_evidence==[] and first.claims==[]
        assert search.calls==0 and llm.calls==1
        assert analyzer.lookup(first.article_id) is None
        full=await analyzer.analyze(request())
        assert full.article_id==first.article_id and full.body_hash==first.body_hash
        assert full.one_line_summary==first.summary
        assert search.calls>0 and llm.calls==1
        warm=await analyzer.preview(request())
        assert warm.article_id==full.article_id and warm.summary==full.one_line_summary
        assert not analyzer.extractions
    asyncio.run(scenario())


def test_preview_returns_during_full_source_search_and_does_not_change_article_claims():
    class SlowSearch(Search):
        async def search(self,query,topic='general'):
            self.calls+=1
            if topic=='general':
                self.entered.set()
                await self.release.wait()
            return []
    async def scenario():
        llm,search=CountedLLM(),SlowSearch()
        search.entered,search.release=asyncio.Event(),asyncio.Event()
        analyzer=Analyzer(llm,search)
        task=asyncio.create_task(analyzer.analyze(request()))
        await asyncio.wait_for(search.entered.wait(),1)
        try:
            preview=await asyncio.wait_for(analyzer.preview(request()),0.5)
            assert preview.summary and not task.done() and llm.calls==1
        finally:
            search.release.set()
            full=await task
        assert full.claims and full.headline_explanation.reasons
        assert full.article_id==preview.article_id
    asyncio.run(scenario())


def test_preview_expiry_refresh_and_copy_do_not_reuse_stale_or_mutated_extraction():
    async def scenario():
        llm,search=CountedLLM(),Search()
        analyzer=Analyzer(llm,search)
        first=await analyzer.preview(request())
        summary=first.summary
        first.summary='외부 수정'
        assert (await analyzer.preview(request())).summary==summary
        key=analyzer.cache_key(request())
        analyzer.extractions[key]=(0,analyzer.extractions[key][1])
        await analyzer.preview(request())
        assert llm.calls==2
        await analyzer.preview(request().model_copy(update={'refresh':True}))
        assert llm.calls==3 and search.calls==0
    asyncio.run(scenario())
