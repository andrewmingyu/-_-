import asyncio
import copy
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app import main
from app.errors import ProviderError
from app.models import RelatedArticle, ReportComparisons
from app.service import Analyzer
from test_sources import FakeLLM, FakeSearch, TEXT, request


OTHER = TEXT + ' 시행 시점은 관계부처 협의 후 알릴 예정이다.'


class NewsSearch(FakeSearch):
    def __init__(self, rows=None):
        super().__init__()
        self.news = rows if rows is not None else [{
            'url': 'https://other.example/report', 'publisher': '다른 언론사',
            'title': '제도 개편 검토를 다룬 다른 보도', 'content': '검토와 일정에 관한 검색 요약입니다.',
            'raw_content': OTHER, 'published_date': '2026-11-12',
        }]

    async def search(self, query, topic='general'):
        return copy.deepcopy(self.news) if topic == 'news' else await super().search(query, topic)


class ComparisonLLM(FakeLLM):
    def __init__(self, transform=None, fail=False):
        super().__init__()
        self.transform, self.fail, self.comparison_payload = transform, fail, None

    async def generate(self, instruction, payload, schema):
        if schema is not ReportComparisons:
            return await super().generate(instruction, payload, schema)
        self.comparison_payload = payload
        if self.fail:
            raise ProviderError('rate_limited', 'gemini', 13)
        result = {'reports': [{'report_id': payload['reports'][0]['id'], 'points': [
            {'kind': 'common', 'aspect': 'topic', 'article_quote': TEXT, 'related_quote': TEXT},
            {'kind': 'difference', 'aspect': 'focus', 'article_quote': TEXT,
             'related_quote': '시행 시점은 관계부처 협의 후 알릴 예정이다.'},
        ]}]}
        if self.transform:
            result = self.transform(result, payload)
        return ReportComparisons.model_validate(result)


def test_reporting_comparison_uses_paired_quotes_and_preserves_source_analysis(monkeypatch):
    llm = ComparisonLLM()
    analyzer = Analyzer(llm, NewsSearch())
    monkeypatch.setattr(main, 'analyzer', analyzer)
    with TestClient(main.app) as client:
        response = client.post('/api/articles/analyze', json=request().model_dump(mode='json'))
        assert response.status_code == 200
        data = response.json()
        report = data['related_articles'][0]
        assert report['comparison_status'] == 'compared'
        assert report['comparison_basis'] == 'body_excerpt'
        assert [p['kind'] for p in report['comparison_points']] == ['common', 'difference']
        for point in report['comparison_points']:
            assert point['article_quote'] in TEXT and point['related_quote'] in OTHER
        assert data['section_states']['related']['status'] == 'ready'
        assert data['claims'][0]['source_status'] == 'original_found'
        assert data['caution']['status'] == 'none_identified'
        assert data['data_version'] == 'source-tracing-v1.12'
        assert '신뢰도' not in report['differences_summary']
        assert '확인하지 못했습니다' in report['independence']


@pytest.mark.parametrize('basis,fields', [
    ('search_snippet', {'content': OTHER}), ('title_only', {'title': OTHER}),
])
def test_comparison_scope_does_not_claim_to_have_read_missing_body(basis, fields):
    llm = ComparisonLLM()
    result = asyncio.run(Analyzer(llm, NewsSearch([{'url': 'https://other.example/1', **fields}])).analyze(request()))
    assert result.related_articles[0].comparison_basis == basis
    assert result.related_articles[0].comparison_status == 'compared'
    assert llm.comparison_payload['reports'][0]['basis'] == basis


def test_rejects_invented_ids_quotes_and_cross_report_attribution():
    def forged(result, payload):
        valid = result['reports'][0]
        valid['points'].append({**valid['points'][0], 'article_quote': '원래 기사에는 전혀 존재하지 않는 문장입니다.'})
        valid['points'].append({**valid['points'][0], 'related_quote': '비교 보도에는 전혀 존재하지 않는 문장입니다.'})
        result['reports'].append({'report_id': 'invented', 'points': valid['points'][:1]})
        result['reports'].append({'report_id': payload['reports'][1]['id'], 'points': valid['points'][:1]})
        return result
    search = NewsSearch()
    search.news.append({'url': 'https://another.example/2', 'content': '이 자료는 다른 사건의 관측 시점만 다루고 있습니다.'})
    result = asyncio.run(Analyzer(ComparisonLLM(transform=forged), search).analyze(request()))
    assert len(result.related_articles[0].comparison_points) == 2
    assert result.related_articles[1].comparison_status == 'insufficient'
    assert not result.related_articles[1].comparison_points
    assert result.section_states['related'].status == 'partial'


def test_failed_comparison_keeps_news_and_retries_without_poisoning_cache():
    async def scenario():
        llm = ComparisonLLM(fail=True)
        analyzer = Analyzer(llm, NewsSearch())
        result = await analyzer.analyze(request())
        assert result.related_articles[0].title and result.related_articles[0].comparison_status == 'failed'
        assert result.sources[0].original_status == 'original_found'
        assert result.search_status == 'completed'
        assert result.section_states['related'].status == 'partial'
        error = result.pipeline_errors[-1]
        assert error.phase == 'related_comparison' and error.retry_after_seconds == 13
        assert not analyzer.cache
        llm.fail = False
        retried = await analyzer.analyze(request())
        assert retried.related_articles[0].comparison_status == 'compared'
        assert analyzer.cache
    asyncio.run(scenario())


def test_legacy_defaults_work_and_unpaired_or_truth_fields_are_rejected():
    old = dict(url='https://other.example/1', title='기존 보도', differences_summary='미비교')
    assert RelatedArticle(**old).comparison_status == 'not_compared'
    with pytest.raises(ValidationError):
        RelatedArticle(**old, comparison_status='compared')
    with pytest.raises(ValidationError):
        ReportComparisons.model_validate({'reports': [{'report_id': 'r', 'points': [{
            'kind': 'supports', 'aspect': 'topic', 'article_quote': TEXT, 'related_quote': TEXT,
        }]}]})


def test_related_list_keeps_five_news_items_but_limits_ai_comparison_to_three():
    rows = [{'url': f'https://report-{index}.example/news', 'title': f'가상 관련 보도 {index}',
             'publisher': f'가상언론{index}', 'content': OTHER} for index in range(6)]
    llm = ComparisonLLM()
    result = asyncio.run(Analyzer(llm, NewsSearch(rows)).analyze(request()))
    assert len(result.related_articles) == 5
    assert len(llm.comparison_payload['reports']) == 3
    assert all(report.comparison_status == 'not_compared' for report in result.related_articles[3:])
