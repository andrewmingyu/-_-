import asyncio
import os
import pytest
from pydantic import ValidationError
from app.clients import Tavily
from app.models import AnalyzeRequest, Article, RelatedVideo
from app.service import Analyzer
from app.videos import channel_label, find_videos, video_id
from test_foreign_search import LLM, Search, URL


def test_video_id_from_common_youtube_urls_only():
    assert video_id('https://www.youtube.com/watch?v=abcdefghijk&t=3') == 'abcdefghijk'
    assert video_id('https://youtu.be/abcdefghijk') == 'abcdefghijk'
    assert video_id('https://www.youtube.com/shorts/abcdefghijk') == 'abcdefghijk'
    assert video_id('https://www.youtube.com/@KBSNews') is None      # 채널 페이지는 영상이 아니다
    assert video_id('https://evil.example/watch?v=abcdefghijk') is None
    assert video_id('https://www.youtube.com.evil.example/watch?v=abcdefghijk') is None
    assert video_id('https://www.youtube.com/watch?v=short') is None


def test_only_exact_official_channel_names_are_accepted():
    assert channel_label('KBS News') == 'KBS 뉴스' and channel_label('SBS 뉴스') == 'SBS 뉴스'
    assert channel_label('연합뉴스TV Yonhapnews TV') == '연합뉴스TV' and channel_label('BBC News') == 'BBC News'
    assert channel_label('KBS News Fan') is None and channel_label('가짜 SBS 뉴스') is None and channel_label('') is None


class FakeOEmbed:
    def __init__(self, table):
        self.table, self.calls = table, []

    async def fetch(self, vid):
        self.calls.append(vid)
        return self.table.get(vid)


def rows(*vids):
    return [{'url': f'https://www.youtube.com/watch?v={v}', 'title': 't', 'content': 'c'} for v in vids]


def test_find_videos_keeps_official_relevant_unique_videos_up_to_limit():
    async def search(query):
        return rows('aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa', 'ddddddddddd')
    oembed = FakeOEmbed({
        'aaaaaaaaaaa': {'title': '정부 발표 논란 SBS 보도', 'channel': 'SBS 뉴스', 'thumbnail': 'https://i.ytimg.com/vi/a/hq.jpg'},
        'bbbbbbbbbbb': {'title': '정부 발표 논란 개인 채널', 'channel': '아무개TV', 'thumbnail': ''},   # 공식 채널이 아님
        'ccccccccccc': {'title': '날씨 소식', 'channel': 'KBS News', 'thumbnail': ''},               # 주제 불일치
        'ddddddddddd': None,                                                                         # oEmbed 실패
    })
    got = asyncio.run(find_videos(search, oembed, [('ko', 'q')], lambda kind, row: '정부 발표' in row['title'], limit=3))
    assert [v['video_id'] for v in got] == ['aaaaaaaaaaa'] and got[0]['channel_label'] == 'SBS 뉴스'
    assert oembed.calls.count('aaaaaaaaaaa') == 1  # 중복 영상은 한 번만 확인


def test_find_videos_survives_failed_searches_and_respects_limit():
    async def search(query):
        if query == 'bad':
            raise RuntimeError('x')
        return rows(*['abcdefghij' + c for c in 'abcde'])
    table = {f'abcdefghij{c}': {'title': 'ok', 'channel': 'CNN', 'thumbnail': ''} for c in 'abcde'}
    got = asyncio.run(find_videos(search, FakeOEmbed(table), [('ko', 'bad'), ('en', 'good')], lambda k, r: True, limit=2))
    assert len(got) == 2


class VSearch(Search):
    def __init__(self):
        super().__init__(); self.video_queries = []

    async def search_videos(self, query):
        self.video_queries.append(query)
        return rows('aaaaaaaaaaa', 'bbbbbbbbbbb')


TABLE = {'aaaaaaaaaaa': {'title': '엔비디아 CEO 소문 부인 보도', 'channel': 'YTN', 'thumbnail': 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg'},
         'bbbbbbbbbbb': {'title': '엔비디아 CEO 소문 부인 영상', 'channel': '아무개TV', 'thumbnail': ''}}


def analyze(search, video, text='로이터는 엔비디아 CEO가 해당 소문을 부인했다고 보도했다.'):
    req = AnalyzeRequest(url=URL, title='엔비디아 CEO 소문 부인', page_text=text, metadata=Article(url=URL, title='엔비디아 CEO 소문 부인'))
    return asyncio.run(Analyzer(LLM(), search, video=video).analyze(req))


def test_related_videos_are_listed_with_thumbnail_and_channel_label(monkeypatch):
    s = VSearch()
    result = analyze(s, FakeOEmbed(TABLE))
    assert [v.channel_label for v in result.related_videos] == ['YTN']
    video = result.related_videos[0]
    assert str(video.url) == 'https://www.youtube.com/watch?v=aaaaaaaaaaa' and str(video.thumbnail_url).startswith('https://i.ytimg.com/')
    assert s.video_queries and s.video_queries[0].startswith('엔비디아 CEO 소문 부인')
    monkeypatch.setenv('VIDEO_SEARCH', 'off')
    assert analyze(VSearch(), FakeOEmbed(TABLE)).related_videos == []


def test_video_search_is_optional_and_never_breaks_the_analysis():
    assert analyze(VSearch(), None).related_videos == []      # oEmbed 확인기가 없으면 건너뛴다
    assert analyze(Search(), FakeOEmbed(TABLE)).related_videos == []  # 검색기가 영상 검색을 지원하지 않으면 건너뛴다

    class Boom(VSearch):
        async def search_videos(self, query):
            raise RuntimeError('x')
    assert analyze(Boom(), FakeOEmbed(TABLE)).related_videos == []


def test_model_rejects_non_youtube_video_or_thumbnail():
    base = dict(id='v', url='https://youtu.be/abcdefghijk', title='t', channel='c', channel_label='YTN')
    RelatedVideo(**base, thumbnail_url='https://i.ytimg.com/vi/x/hq.jpg')
    for bad in ({'url': 'https://evil.example/x'}, {'thumbnail_url': 'https://evil.example/a.jpg'}, {'extra': 1}):
        with pytest.raises(ValidationError):
            RelatedVideo(**{**base, **bad})


def test_tavily_video_search_is_limited_to_youtube_without_page_bodies(monkeypatch):
    seen = {}

    async def fake_request(self, endpoint, payload):
        seen.update(endpoint=endpoint, payload=payload)
        return []
    monkeypatch.setattr(Tavily, '_request', fake_request)
    asyncio.run(Tavily().search_videos('엔비디아'))
    assert seen['endpoint'] == 'search' and seen['payload']['include_domains'] == ['youtube.com']
    assert seen['payload']['include_raw_content'] is False and seen['payload']['search_depth'] == 'basic'


def test_videos_from_other_years_or_sharing_only_generic_words_are_dropped():
    table = {'aaaaaaaaaaa': {'title': '엔비디아 CEO 소문 부인 (2018.03.12)', 'channel': 'YTN', 'thumbnail': ''},
             'bbbbbbbbbbb': {'title': '엔비디아 CEO 소문 부인 (2025.08.25)', 'channel': 'KBS 뉴스', 'thumbnail': ''}}
    req = AnalyzeRequest(url=URL, title='엔비디아 CEO 소문 부인', page_text='로이터는 엔비디아 CEO가 해당 소문을 부인했다고 보도했다.',
                         metadata=Article(url=URL, title='엔비디아 CEO 소문 부인', published_at='2018-03-12T03:10:00+09:00'))
    got = asyncio.run(Analyzer(LLM(), VSearch(), video=FakeOEmbed(table)).analyze(req)).related_videos
    assert [v.channel_label for v in got] == ['YTN']
    table = {'aaaaaaaaaaa': {'title': '대통령 소문 영상', 'channel': 'YTN', 'thumbnail': ''}}
    assert analyze(VSearch(), FakeOEmbed(table)).related_videos == []


def test_find_videos_can_keep_one_video_per_channel():
    table = {f'abcdefghij{c}': {'title': 'ok', 'channel': 'YTN' if c in 'ab' else 'CNN', 'thumbnail': ''} for c in 'abc'}
    async def search(query):
        return rows(*table)
    got = asyncio.run(find_videos(search, FakeOEmbed(table), [('ko', 'x')], lambda k, r: True, limit=3, one_per_channel=True))
    assert [v['channel_label'] for v in got] == ['YTN', 'CNN']
