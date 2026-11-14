from app.models import TimelineItem
from app.service import timeline_date_key, order_timeline


def item(date, label, main=False):
    return TimelineItem(date=date, description=label, article_quote=label, label=label, is_main_event=main)


def labels(items):
    return [t.label for t in items]


def test_day_only_dates_follow_when_they_happened_not_article_order():
    # 전한길 기사: 14일 일을 먼저 쓰고 '앞서 6일'을 뒤에 덧붙인 경우
    items = [item('14일', '추가 고소 예고', True), item('6일', '이전 고소 건 송치')]
    ordered = order_timeline(items, '2026-11-14T09:00:00+09:00')
    assert labels(ordered) == ['이전 고소 건 송치', '추가 고소 예고']
    assert ordered[1].is_main_event


def test_undated_main_event_sorts_at_report_date_after_background():
    # 고경표 기사: 날짜 없는 주요 사건은 화면의 '(보도일)'과 같은 작성일로 정렬
    items = [item('시점 미확인', '음주운전 사고 조사', True), item('2010년', '데뷔')]
    assert labels(order_timeline(items, '2026-11-14T11:07:00+09:00')) == ['데뷔', '음주운전 사고 조사']


def test_relative_dates_use_the_article_date():
    pub = '2026-11-02'
    assert timeline_date_key('30일', pub) == (2026, 10, 30)          # 작성일보다 뒤의 날짜 → 지난달
    assert timeline_date_key('오는 30일', pub) == (2026, 11, 30)     # 앞으로의 일 → 이번 달
    assert timeline_date_key('오는 1일', pub) == (2026, 12, 1)       # 이미 지난 날짜에 '오는' → 다음 달
    assert timeline_date_key('지난 12월', pub) == (2025, 12, 1)
    assert timeline_date_key('8일(현지시간)', '2026-11-09') == (2026, 11, 8)
    assert timeline_date_key('2018년 3월 9일', pub) == (2018, 3, 9)
    assert timeline_date_key('March 12, 2018', pub) == (2018, 3, 12)
    assert timeline_date_key('시점 미확인', pub) == (2026, 11, 2)


def test_unknown_expressions_stay_in_place_and_ties_keep_model_order():
    items = [item('14일', 'A'), item('최근', 'B'), item('6일', 'C'), item('14일', 'D')]
    assert labels(order_timeline(items, '2026-11-14')) == ['C', 'B', 'A', 'D']


def test_without_article_date_only_absolute_dates_move():
    items = [item('14일', 'A'), item('2010년', 'B'), item('2007년', 'C')]
    assert labels(order_timeline(items, None)) == ['A', 'C', 'B']


def test_extraction_step_reorders_the_model_timeline_with_the_article_date():
    import asyncio
    from app.models import AnalyzeRequest, Extraction
    from app.service import Analyzer
    late = '이 의원은 14일 자신의 페이스북을 통해 추가 고소하겠다고 예고했다.'
    early = '앞서 이 의원은 6일에도 고소 건이 송치됐다고 밝힌 바 있다.'
    text = late + ' ' + early
    raw = Extraction(summary=late, headline_difference='', claims=[], evidence_mentions=[], context_timeline=[
        {'date': '14일', 'label': '추가 고소 예고', 'description': late, 'article_quote': late, 'is_main_event': True},
        {'date': '6일', 'label': '이전 고소 건 송치', 'description': early, 'article_quote': early}])

    class LLM:
        async def generate(self, *args):
            return raw

    analyzer = Analyzer.__new__(Analyzer)
    analyzer.llm = LLM()
    request = AnalyzeRequest(url='https://news.example/a', title='t', page_text=text,
                             metadata={'url': 'https://news.example/a', 'title': 't', 'published_at': '2026-11-14T09:00:00+09:00'})
    out = asyncio.run(analyzer._extract_once(request))
    assert [t.label for t in out.context_timeline] == ['이전 고소 건 송치', '추가 고소 예고']
    assert out.context_timeline[1].is_main_event
