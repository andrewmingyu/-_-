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


def _bbc_llm(judged):
    from app.service import OriginalJudgement

    class JLLM(LLM):
        calls = 0

        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:  # 영어 제목 추정이 틀린 경우
                return EnglishQuery(query='wrong guess', document_title_en='completely different title words')
            if schema is OriginalJudgement:
                JLLM.calls += 1
                return OriginalJudgement(original_id=judged(payload), reason='같은 보도')
            if schema is Extraction:
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=BBC_TEXT, claim_text=BBC_TEXT, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': BBC_TEXT,
                        'source_label': 'BBC', 'document_title': None, 'source_kind': 'news'}])
            return SourceReviews(sources=[])
    return JLLM


class _BbcSearch(Search):
    async def search(self, query, topic='general'):
        if topic == 'news':
            return []
        return [{'url': 'https://www.bbc.com/news/x', 'content': 'x', 'raw_content': 'body text',
                 'title': 'Something unrelated to the guessed title - BBC News'}]


def _run_bbc(llm_cls):
    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    return asyncio.run(Analyzer(llm_cls(), _BbcSearch()).analyze(req))


def test_llm_judgement_finds_the_original_when_the_estimated_title_is_wrong():
    cls = _bbc_llm(lambda p: p['candidates'][0]['id'])
    result = _run_bbc(cls)
    assert cls.calls == 1
    assert 'bbc.com' in str(result.related_articles[0].url)
    assert result.related_articles[0].original_candidate is True  # 후보일 뿐 원본 확인으로 승격하지 않는다
    assert all(not s.mention_ids for s in result.sources if 'bbc.com' in str(s.url))


def test_llm_judgement_with_invented_id_or_none_adds_nothing(monkeypatch):
    for judged in (lambda p: 'src_invented', lambda p: None):
        result = _run_bbc(_bbc_llm(judged))
        assert not any('bbc.com' in str(r.url) for r in result.related_articles)
    monkeypatch.setenv('ORIGINAL_JUDGE', 'off')
    cls = _bbc_llm(lambda p: p['candidates'][0]['id'])
    _run_bbc(cls)
    assert cls.calls == 0


def test_empty_document_extract_is_retried_once():
    class RSearch(_BbcSearch):
        def __init__(self):
            super().__init__(); self.calls = 0

        async def search(self, query, topic='general'):
            rows = await super().search(query, topic)
            return [dict(r, raw_content='') for r in rows]

        async def extract(self, urls):
            self.calls += 1
            return [] if self.calls == 1 else [{'url': u, 'raw_content': 'body text'} for u in urls]

    search = RSearch()
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    result = asyncio.run(Analyzer(_bbc_llm(lambda p: None)(), search).analyze(req))
    assert search.calls == 2
    assert any(s.content_status == 'retrieved' for s in result.sources if 'bbc.com' in str(s.url))


def test_judgement_pool_prefers_candidates_overlapping_the_english_query():
    seen = {}
    from app.service import OriginalJudgement

    class PLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is OriginalJudgement:
                seen['ids'] = [c['title'] for c in payload['candidates']]
                return OriginalJudgement(original_id=None)
            return await super().generate(instruction, payload, schema)

    rows = [{'url': f'https://www.bbc.com/news/{i}', 'title': f'Unrelated story {i}', 'content': 'x', 'raw_content': 'weather sports'} for i in range(8)]
    rows.append({'url': 'https://www.bbc.com/news/target', 'title': 'Moon Jae-in Nobel Peace Prize gamble', 'content': 'x',
                 'raw_content': 'Moon Jae-in Nobel Peace Prize North Korea talks'})

    class PSearch(Search):
        async def search(self, query, topic='general'):
            return [] if topic == 'news' else [dict(r) for r in rows]

    class Q(PLLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC Moon Jae-in Nobel Peace Prize North Korea')
            return await super().generate(instruction, payload, schema)

    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    asyncio.run(Analyzer(Q(label='BBC', quote=BBC_TEXT), PSearch()).analyze(req))
    assert 'Moon Jae-in Nobel Peace Prize gamble' in seen['ids'] and len(seen['ids']) == 4


def test_quoted_english_title_and_quote_are_searched_inside_the_outlet_domain_only():
    class TLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC Moon Nobel guess', document_title_en='21st Century political gamble',
                                    quotes_en=['Moon could win a Nobel prize if talks succeed or return to brinkmanship'])
            return await super().generate(instruction, payload, schema)

    s = Search()
    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    asyncio.run(Analyzer(TLLM(label='BBC', quote=BBC_TEXT), s).analyze(req))
    scoped = [q for q, d in s.scoped if 'bbc.com' in d]
    assert '21st Century political gamble' in scoped
    assert any(q.startswith('Moon could win a Nobel') for q in scoped)
    assert '21st Century political gamble' not in s.queries  # 일반 검색에는 쓰지 않아 검색 횟수를 아낀다


def test_extra_scoped_queries_are_skipped_when_no_outlet_is_named():
    class TLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='guess', document_title_en='Some title here', quotes_en=['Some quoted sentence for testing'])
            return await super().generate(instruction, payload, schema)

    s = Search()
    go(TLLM(label='익명 관계자', quote='한 관계자는 소문을 부인했다고 밝혔다.'), s, text='한 관계자는 소문을 부인했다고 밝혔다.', title='소문 부인')
    assert s.scoped == []


def test_korean_outlets_map_to_their_domains_and_the_own_site_is_not_searched():
    assert domains_for('조선일보 보도') == ['chosun.com'] and 'yna.co.kr' in domains_for('연합뉴스는 전했다')
    assert domains_for('YTN은 전했다') == ['ytn.co.kr'] and domains_for('wyatn') == []
    s = Search()
    text = '한겨레는 이날 조선일보 보도를 인용해 정부가 발표했다고 전했다.'
    req = AnalyzeRequest(url='https://www.chosun.com/a/1', title='정부 발표 논란', page_text=text,
                         metadata=Article(url='https://www.chosun.com/a/1', title='정부 발표 논란'))
    class L(LLM):
        pass
    asyncio.run(Analyzer(L(label='한겨레', quote=text), s).analyze(req))
    searched = {d for _, ds in s.scoped for d in ds}
    assert 'hani.co.kr' in searched and 'chosun.com' not in searched  # 기사를 낸 매체 도메인은 제외


def test_named_outlet_coverage_comes_first_in_related_articles_and_can_be_switched_off(monkeypatch):
    class OS(Search):
        async def search(self, query, topic='general'):
            return [{'url': 'https://other.example/n', 'title': '정부 발표 논란 다른 보도', 'content': '정부 발표 논란 내용'}] if topic == 'news' else []

        async def search_in(self, query, domains=None):
            self.scoped.append((query, list(domains or [])))
            if 'yna.co.kr' not in (domains or []):
                return []  # 비평 매체 검색 등 다른 도메인 검색에는 결과가 없다
            return [{'url': 'https://www.yna.co.kr/view/1', 'title': '정부 발표 논란 연합뉴스 보도', 'content': '정부 발표 논란 상세'},
                    {'url': 'https://www.yna.co.kr/view/2', 'title': '날씨 소식', 'content': '맑음'}]

    text = '연합뉴스는 정부가 발표했다고 전했다.'
    def run():
        req = AnalyzeRequest(url=URL, title='정부 발표 논란', page_text=text, metadata=Article(url=URL, title='정부 발표 논란'))
        return asyncio.run(Analyzer(LLM(label='연합뉴스', quote=text), OS()).analyze(req))
    urls = [str(r.url) for r in run().related_articles]
    assert 'yna.co.kr' in urls[0] and not any('view/2' in u for u in urls)  # 관련 없는 제목은 거른다
    monkeypatch.setenv('OUTLET_FOCUS', 'off')
    assert not any('yna.co.kr' in str(r.url) for r in run().related_articles)


def _weak_pick_setup(judged):
    """영어 원제는 어느 페이지와도 안 맞고, 인용문 단어만으로 같은 매체의 다른 기사가 높은 점수를 받는 상황."""
    from app.service import OriginalJudgement
    quote = 'Moon could win the Nobel Peace Prize if he succeeds in persuading North Korea toward denuclearisation talks'

    class WLLM(LLM):
        calls = 0

        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                return EnglishQuery(query='BBC Moon Nobel', document_title_en='zzz unrelated title words here', quotes_en=[quote])
            if schema is OriginalJudgement:
                WLLM.calls += 1
                return OriginalJudgement(original_id=judged(payload))
            if schema is Extraction:
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=BBC_TEXT, claim_text=BBC_TEXT, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': BBC_TEXT,
                        'source_label': 'BBC', 'document_title': None, 'source_kind': 'news'}])
            return SourceReviews(sources=[])

    class WSearch(Search):
        async def search(self, query, topic='general'):
            if topic == 'news':
                return []
            return [{'url': 'https://www.bbc.com/news/wrong', 'title': 'Other story', 'content': 'x',
                     'raw_content': quote + ' plus unrelated detail about something else entirely'},
                    {'url': 'https://www.bbc.com/news/right', 'title': 'The real report', 'content': 'snippet of the real report', 'raw_content': ''}]

    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    return WLLM, WSearch, req


def test_weak_quote_only_pick_is_dropped_when_the_judge_says_it_is_not_the_same_report():
    WLLM, WSearch, req = _weak_pick_setup(lambda p: None)
    result = asyncio.run(Analyzer(WLLM(), WSearch()).analyze(req))
    assert WLLM.calls == 1
    assert not any('bbc.com/news/wrong' in str(r.url) for r in result.related_articles)


def test_judge_failure_keeps_the_weak_pick_and_snippet_only_pages_are_shown_to_the_judge():
    from app.service import OriginalJudgement
    seen = {}
    WLLM, WSearch, req = _weak_pick_setup(lambda p: seen.setdefault('texts', {c['url']: c['text'] for c in p['candidates']}) and None)
    asyncio.run(Analyzer(WLLM(), WSearch()).analyze(req))
    assert seen['texts']['https://www.bbc.com/news/right'] == 'snippet of the real report'  # 본문 추출 실패 페이지도 요약으로 판정
    # 판정이 실패(예외)하면 기존 선택을 유지한다
    class Boom(WLLM):
        async def generate(self, instruction, payload, schema):
            if schema is OriginalJudgement:
                raise RuntimeError('x')
            return await super().generate(instruction, payload, schema)
    result = asyncio.run(Analyzer(Boom(), WSearch()).analyze(req))
    assert any('bbc.com/news/wrong' in str(r.url) for r in result.related_articles)


def test_critic_outlets_are_searched_for_pieces_about_this_article_and_listed_first(monkeypatch):
    from app.outlets import CRITIC_DOMAINS
    calls = []

    class CS(Search):
        async def search(self, query, topic='general'):
            return [{'url': 'https://other.example/n', 'title': '정부 발표 논란 다른 보도', 'content': '정부 발표 논란 내용'}] if topic == 'news' else []

        async def search_in(self, query, domains=None):
            calls.append((query, list(domains or [])))
            if domains and 'ohmynews.com' in domains:
                return [{'url': 'https://www.ohmynews.com/c/1', 'title': '<연합>, 정부 발표 알고도 왜곡했다',
                         'content': '연합뉴스의 정부 발표 논란 기사를 지적하는 칼럼입니다.'},
                        {'url': 'https://www.ohmynews.com/c/2', 'title': '날씨', 'content': '맑음'}]
            return []

    text = '연합뉴스는 정부가 발표했다고 전했다.'
    def run():
        req = AnalyzeRequest(url=URL, title='정부 발표 논란', page_text=text, metadata=Article(url=URL, title='정부 발표 논란'))
        return asyncio.run(Analyzer(LLM(label='연합뉴스', quote=text), CS()).analyze(req))
    urls = [str(r.url) for r in run().related_articles]
    assert 'ohmynews.com/c/1' in urls[0] and not any('c/2' in u for u in urls)  # 비평 글이 맨 앞, 무관한 글은 제외
    critic_calls = [c for c in calls if set(c[1]) == set(CRITIC_DOMAINS)]
    assert critic_calls and '왜곡' in critic_calls[0][0]
    calls.clear()
    monkeypatch.setenv('CRITIC_SEARCH', 'off')
    assert not any('ohmynews.com' in str(r.url) for r in run().related_articles)
    assert not any(set(c[1]) == set(CRITIC_DOMAINS) for c in calls)


def test_critic_search_is_skipped_when_no_outlet_is_named():
    from app.outlets import CRITIC_DOMAINS
    s = Search()
    go(LLM(label='익명 관계자', quote='한 관계자는 소문을 부인했다고 밝혔다.'), s, text='한 관계자는 소문을 부인했다고 밝혔다.', title='소문 부인')
    assert not any(set(d) == set(CRITIC_DOMAINS) for _, d in s.scoped)


def test_quoted_title_is_taken_from_the_body_even_if_extraction_missed_it():
    from app.service import EnglishTitle, quoted_titles
    assert quoted_titles(BBC_TEXT) == ['21세기 정치적 도박'] and quoted_titles('한 관계자가 부인했다.') == []
    seen = {}

    class QLLM(LLM):
        async def generate(self, instruction, payload, schema):
            if schema is EnglishQuery:
                seen['payload'] = payload
                return EnglishQuery(query='BBC Moon Nobel')  # document_title_en을 비워 두는 경우
            if schema is EnglishTitle:
                seen['translated'] = payload['titles']
                return EnglishTitle(title_en='The political gamble of the 21st Century')
            if schema is Extraction:  # 추출 단계가 document_title을 놓친 경우
                return Extraction(summary='s', headline_difference='h',
                    claims=[Claim(id='c1', original_text=BBC_TEXT, claim_text=BBC_TEXT, claim_type='quotation')],
                    evidence_mentions=[{'id': 'm1', 'claim_ids': ['c1'], 'description': 'd', 'article_quote': BBC_TEXT,
                        'source_label': 'BBC', 'document_title': None, 'source_kind': 'news'}])
            return SourceReviews(sources=[])

    s = Search()
    os.environ['ENGLISH_SEARCH'] = 'on'
    req = AnalyzeRequest(url=URL, title='BBC 문대통령 노벨상', page_text=BBC_TEXT, metadata=Article(url=URL, title='BBC 문대통령 노벨상'))
    asyncio.run(Analyzer(QLLM(label='BBC', quote=BBC_TEXT), s).analyze(req))
    assert seen['payload']['quoted_titles'] == ['21세기 정치적 도박']
    assert seen['translated'] == ['21세기 정치적 도박']
    assert any(q == 'The political gamble of the 21st Century' and 'bbc.com' in d for q, d in s.scoped)  # 영어 원제로 매체 도메인 검색
