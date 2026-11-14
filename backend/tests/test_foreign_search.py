import asyncio
import os
from app.models import AnalyzeRequest, Article, Claim, Extraction, SourceReviews
from app.outlets import domains_for
from app.service import Analyzer, EnglishQuery

TEXT = '로이터는 엔비디아 CEO가 해당 소문을 부인했다고 보도했다.'
URL = 'https://news.example/a/1'


class LLM:
    def __init__(self, label='로이터', fail=False, quote=TEXT):
        self.label, self.fail, self.quote = label, fail, quote

    async def generate(self, instruction, payload, schema):
        if schema is EnglishQuery:
            if self.fail:
                raise RuntimeError('x')
            return EnglishQuery(query='Nvidia CEO denies rumor Reuters')
        if schema is Extraction:
            return Extraction(summary='s', headline_difference='h',
                claims=[Claim(id='c1', original_text=TEXT, claim_text=TEXT, claim_type='quotation')],
                evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': self.quote,
                    'source_label': self.label, 'document_title': None, 'source_kind': 'news'}])
        return SourceReviews(sources=[])


class Search:
    def __init__(self):
        self.queries, self.scoped = [], []

    async def search(self, query, topic='general'):
        if topic == 'general':
            self.queries.append(query)
        return []

    async def search_in(self, query, domains=None):
        self.scoped.append((query, list(domains or [])))
        return []


def go(llm, search, text=TEXT, title='엔비디아 CEO 소문 부인'):
    os.environ['ENGLISH_SEARCH'] = os.environ.get('ENGLISH_SEARCH_TEST', 'on')
    req = AnalyzeRequest(url=URL, title=title, page_text=text, metadata=Article(url=URL, title=title))
    asyncio.run(Analyzer(llm, search).analyze(req))


def test_domains_for_named_outlet_only():
    assert 'reuters.com' in domains_for('로이터 보도')
    assert domains_for('익명의 관계자는 말했다') == []
    assert domains_for('MAP data') == []  # 짧은 영문 약어는 단어 경계로만 일치


def test_english_query_added_and_scoped_search_only_when_outlet_named():
    s = Search(); go(LLM(), s)
    assert any(q.startswith('Nvidia CEO denies') for q in s.queries)
    assert s.scoped and 'reuters.com' in s.scoped[0][1]
    s2 = Search(); go(LLM(label='익명 관계자', quote='한 관계자는 소문을 부인했다고 밝혔다.'), s2, text='한 관계자는 소문을 부인했다고 밝혔다.', title='소문 부인')
    assert s2.scoped == []


def test_english_query_failure_and_switch(monkeypatch):
    s = Search(); go(LLM(fail=True), s)
    assert all(not q.startswith('Nvidia') for q in s.queries)
    monkeypatch.setenv('ENGLISH_SEARCH_TEST', 'off')
    s = Search(); go(LLM(), s)
    assert all(not q.startswith('Nvidia') for q in s.queries)


def test_domains_for_matches_english_name_before_korean_particle():
    assert 'bbc.com' in domains_for('BBC는 이날 보도했다')
    assert 'reuters.com' in domains_for('로이터통신에 따르면')
    assert domains_for('MAP과 CAP') == []


def test_title_matches_uses_word_coverage_not_exact_string():
    from app.service import title_matches
    page = 'Trump and North Korea talks: The political gamble of the 21st Century - BBC News'
    assert title_matches(['21st century political gamble'], page)
    assert not title_matches(['Trump can have Nobel Peace Prize says Moon'], page)
    assert not title_matches(['political gamble'], page)  # 핵심 단어 3개 미만이면 연결하지 않는다


def test_related_articles_include_english_news_results():
    class NewsSearch(Search):
        async def search(self, query, topic='general'):
            if topic == 'news':
                tag = 'en' if query.startswith('Nvidia') else 'ko'
                title = 'Nvidia CEO denies rumor, Reuters reports' if tag == 'en' else '엔비디아 CEO 소문 부인'
                return [{'url': f'https://{tag}.example.com/{tag}{i}', 'title': f'{title} {i}', 'content': 'c',
                         'published_date': '2026-11-10'} for i in range(3)]
            return await super().search(query, topic)

    class Compare(LLM):
        async def generate(self, instruction, payload, schema):
            from app.models import ReportComparisons
            if schema is ReportComparisons:
                return ReportComparisons(comparisons=[])
            return await super().generate(instruction, payload, schema)

    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='엔비디아 CEO 소문 부인', page_text=TEXT, metadata=Article(url=URL, title='엔비디아 CEO 소문 부인'))
    result = asyncio.run(Analyzer(Compare(), NewsSearch()).analyze(req))
    urls = [str(r.url) for r in result.related_articles]
    assert any('en.example.com' in u for u in urls) and any('ko.example.com' in u for u in urls)
    assert any('en.example.com' in u for u in urls[:3])


BBC_TEXT = 'BBC는 이날 \'21세기 정치적 도박\'이라는 제목의 기사에서 문 대통령의 외교를 평가했다고 보도했다.'


def test_outlet_domain_and_estimated_title_match_only_create_an_original_candidate():
    class BbcLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC 21st century political gamble', document_title_en='21st century political gamble')
            if schema is Extraction:
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=BBC_TEXT, claim_text=BBC_TEXT, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': BBC_TEXT,
                        'source_label': 'BBC', 'document_title': '21세기 정치적 도박', 'source_kind': 'news'}])
            return SourceReviews(sources=[])

    class BbcSearch(Search):
        async def search(self, query, topic='general'):
            if topic == 'news':
                return []
            return [{'url': 'https://www.bbc.com/news/world-asia-43334320', 'content': 'x', 'raw_content': 'body',
                     'title': 'Trump and North Korea talks: The political gamble of the 21st Century - BBC News'},
                    {'url': 'https://guardian.ng/news/x', 'content': 'x', 'raw_content': 'body',
                     'title': 'Trump can have Nobel Peace Prize, says Moon'}]

    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    result = asyncio.run(Analyzer(BbcLLM(), BbcSearch()).analyze(req))
    bbc = [x for x in result.sources if 'bbc.com' in str(x.url)][0]
    other = [x for x in result.sources if 'guardian.ng' in str(x.url)][0]
    assert bbc.original_status == 'unknown' and bbc.discovery == 'external_found' and not bbc.mention_ids
    assert result.related_articles[0].original_candidate is True
    assert not result.related_articles[0].cited_by_article
    assert other.original_status == 'unknown' and not other.mention_ids


def test_translated_quote_similarity_does_not_confirm_an_original():
    class QLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC Moon Nobel', document_title_en='unrelated words here',
                    quotes_en=['Moon could win the Nobel Peace Prize if talks succeed in reducing nuclear threat'])
            if schema is Extraction:
                text = payload['body']
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=text, claim_text=text, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': text,
                        'source_label': None, 'document_title': None, 'source_kind': 'news'}])
            return SourceReviews(sources=[])

    class QSearch(Search):
        async def search(self, query, topic='general'):
            if topic == 'news':
                return []
            body = 'If talks succeed in reducing the nuclear threat, Moon could win the Nobel Peace Prize, analysts said.'
            return [{'url': 'https://www.bbc.com/news/x', 'content': 'x', 'raw_content': body, 'title': 'Totally different headline'},
                    {'url': 'https://blog.example.com/y', 'content': 'x', 'raw_content': body, 'title': 'Copy'}]

    os.environ['ENGLISH_SEARCH'] = 'on'
    text = 'BBC는 문 대통령이 북한 핵 위협을 줄이는 데 성공하면 노벨 평화상을 받을 수 있다고 보도했다.'
    req = AnalyzeRequest(url=URL, title='BBC 보도', page_text=text, metadata=Article(url=URL, title='BBC 보도'))
    result = asyncio.run(Analyzer(QLLM(), QSearch()).analyze(req))
    bbc = [x for x in result.sources if 'bbc.com' in str(x.url)][0]
    blog = [x for x in result.sources if 'blog.example.com' in str(x.url)][0]
    assert bbc.original_status == 'unknown' and not bbc.mention_ids
    assert result.related_articles[0].original_candidate is True
    assert blog.original_status == 'unknown' and not blog.mention_ids  # 매체 도메인이 아니면 본문이 같아도 연결하지 않는다


def test_original_candidate_goes_first_without_becoming_a_verified_source_and_followup_runs():
    from app.models import ReportComparisons
    seen = {}

    class OLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC 21st century political gamble', document_title_en='21st century political gamble')
            if schema is Extraction:
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=BBC_TEXT, claim_text=BBC_TEXT, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': BBC_TEXT,
                        'source_label': 'BBC', 'document_title': '21세기 정치적 도박', 'source_kind': 'news'}])
            if schema is ReportComparisons:
                seen['reports'] = payload['reports']
                return ReportComparisons(reports=[])
            return SourceReviews(sources=[])

    class OSearch(Search):
        def __init__(self):
            super().__init__(); self.news = []

        async def search(self, query, topic='general'):
            if topic == 'news':
                self.news.append(query)
                return [{'url': 'https://www.ohmynews.com/a', 'title': 'BBC 보도 왜곡 논란', 'content': 'c'}] if '논란 정정 반박' in query else []
            return [{'url': 'https://www.bbc.com/news/x', 'content': 'x', 'raw_content': 'body text',
                     'title': 'Trump and North Korea talks: The political gamble of the 21st Century - BBC News'}]

    os.environ['ENGLISH_SEARCH'] = 'on'
    os.environ['FOLLOWUP_SEARCH'] = 'on'
    search = OSearch()
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    result = asyncio.run(Analyzer(OLLM(), search).analyze(req))
    urls = [str(r.url) for r in result.related_articles]
    assert 'bbc.com' in urls[0] and any('ohmynews.com' in u for u in urls)
    assert seen['reports'][0]['is_original'] is False
    assert seen['reports'][0]['is_original_candidate'] is True
    assert any('논란 정정 반박' in q for q in search.news)


def test_only_the_best_matching_outlet_page_is_linked():
    from app.service import best_original
    cands = [{'id': 'a', 'url': 'https://www.bbc.com/news/1', 'title': 'Trump-Kim talks show US strategy is working - VP Pence', 'content': 'Moon Trump talks nuclear'},
             {'id': 'b', 'url': 'https://www.bbc.com/news/2', 'title': 'Trump and North Korea talks: The political gamble of the 21st Century - BBC News', 'content': 'x'},
             {'id': 'c', 'url': 'https://blog.example.com/3', 'title': 'Trump and North Korea talks: The political gamble of the 21st Century', 'content': 'x'}]
    assert best_original(cands, ['bbc.com'], ['21st century political gamble'], []) == 'b'
    assert best_original(cands[:1], ['bbc.com'], ['21st century political gamble'], []) is None


def test_comparison_point_keeps_korean_translation_and_explanation():
    from app.models import ReportComparisons
    from app.report_comparison import apply_comparisons
    from app.models import RelatedArticle
    article = 'BBC는 문 대통령에 대해 둘 중 하나가 될 것이라고 했다.'
    original = 'Moon is either a diplomatic genius or a communist - depending on who you speak to.'
    report = RelatedArticle(id='r1', url='https://www.bbc.com/news/x', title='t', differences_summary='d', comparison_basis='body_excerpt')
    out = ReportComparisons(reports=[{'report_id': 'r1', 'points': [{
        'kind': 'difference', 'aspect': 'attribution', 'article_quote': article, 'related_quote': original,
        'related_quote_ko': '문 대통령은 외교의 천재이거나 공산주의자인데, 누구에게 묻느냐에 따라 다르다.',
        'explanation': '원문은 사람마다 평가가 다르다고 썼는데 기사는 BBC의 예측으로 옮겼다.'}]}])
    apply_comparisons([report], {'r1': original}, article, out)
    point = report.comparison_points[0]
    assert point.related_quote_ko.startswith('문 대통령은') and '예측' in point.explanation


def test_irrelevant_english_and_followup_rows_are_filtered():
    from app.service import english_relevant, title_overlap
    words = {'bbc', 'moon', 'nobel', 'peace', 'prize', 'political', 'gamble'}
    assert english_relevant({'title': 'Trump and North Korea talks: The political gamble', 'content': 'Moon could win the Nobel Peace Prize'}, words)
    assert not english_relevant({'title': 'Labour should win next election, Starmer says', 'content': 'politics'}, words)
    assert not english_relevant({'title': 'Controversial BBC Panorama', 'content': 'about Trump'}, words)
    title = 'BBC "文대통령 잘되면 노벨상, 안되면 벼랑끝"'
    assert title_overlap({'title': '<조선>, BBC 보도 내용 알고도 왜곡했다', 'content': ''}, title)
    assert not title_overlap({'title': '이스라엘 총선 결과', 'content': '연정 협상'}, title)


def test_similarity_does_not_replace_exact_citation_and_originality_evidence():
    from app.models import Mention, ArticleContext, ArticleLink
    mention=Mention(id='m1',claim_ids=['c1'],description=BBC_TEXT,article_quote=BBC_TEXT,source_label='BBC')
    candidate={'id':'src_bbc','url':'https://www.bbc.com/news/x','title':'21st century political gamble',
        'content':'BBC original publication','published_at':None,'retrieved_at':'2026-11-14T00:00:00Z','content_status':'retrieved'}
    reviews=SourceReviews(sources=[{'source_id':'src_bbc','mention_ids':['m1'],'original_status':'original_found',
        'facts':{'identity':{'excerpt':'BBC'},'originality':{'excerpt':'original publication'}}}])
    # A predicted English title and exact source-property excerpts cannot establish the article citation.
    missing_link=Analyzer.build_sources([mention],[candidate],reviews,english_titles=['21st century political gamble'],outlet_domains=['bbc.com'])[0]
    assert missing_link.original_status=='unknown' and missing_link.discovery=='external_found'
    context=ArticleContext(cited_links=[ArticleLink(url=candidate['url'],text='BBC',article_quote=BBC_TEXT)])
    known=Analyzer.build_sources([mention],[candidate],reviews,article_context=context)[0]
    assert known.original_status=='original_found' and known.discovery=='article_cited'
    # A link proves the citation, but without source evidence it still does not prove originality.
    linked_only=Analyzer.build_sources([mention],[candidate],SourceReviews(sources=[]),article_context=context)[0]
    assert linked_only.discovery=='article_cited' and linked_only.original_status=='unknown'
