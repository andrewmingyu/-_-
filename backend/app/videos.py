"""공신력 있는 방송사·외신 공식 유튜브 채널의 관련 영상 찾기.

검색은 Tavily로 youtube.com 안에서만 하고, 채널명·제목·썸네일은 유튜브 oEmbed(키 불필요)로 확인한다.
채널명이 허용 목록과 정확히 일치할 때만 보여 주며, 영상 내용이 맞는지는 판단하지 않는다.
허용 목록은 `video_channels.json`({"채널명": "표시 이름"})으로 코드 수정 없이 추가할 수 있다."""
import asyncio
import json
import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

# 채널 이름(공백·기호 제거, 소문자) → 화면에 보여 줄 이름. 실제 유튜브 채널명과 다르면 video_channels.json으로 보완한다.
CHANNELS = {
    'sbs뉴스': 'SBS 뉴스', 'sbsnews': 'SBS 뉴스',
    'kbsnews': 'KBS 뉴스', 'kbs뉴스': 'KBS 뉴스',
    'mbcnews': 'MBC 뉴스', 'mbc뉴스': 'MBC 뉴스',
    'jtbcnews': 'JTBC 뉴스', 'jtbc뉴스': 'JTBC 뉴스',
    'ytn': 'YTN', 'ytnnews': 'YTN', 'ytn뉴스': 'YTN',
    '연합뉴스tv': '연합뉴스TV', '연합뉴스tvyonhapnewstv': '연합뉴스TV', 'yonhapnewstv': '연합뉴스TV',
    'bbcnews': 'BBC News', 'bbcnews코리아': 'BBC News 코리아', 'bbckorean': 'BBC News 코리아',
    'cnn': 'CNN',
    'reuters': 'Reuters',
    'bloombergtelevision': 'Bloomberg', 'bloombergnews': 'Bloomberg',
}
YOUTUBE_HOSTS = ('youtube.com', 'youtu.be')
_ID = re.compile(r'[A-Za-z0-9_-]{11}')


def normalize_channel(name):
    """채널명 비교용: 소문자로 바꾸고 공백·괄호·기호를 없앤다."""
    return re.sub(r'[\s()\[\]{}\-_.·|/]+', '', str(name or '').casefold())


@lru_cache
def extra_channels():
    path = Path(__file__).with_name('video_channels.json')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {normalize_channel(k): str(v) for k, v in data.items() if isinstance(v, str) and normalize_channel(k)}


def channel_label(name):
    """허용된 공식 채널이면 표시 이름, 아니면 None. 부분 일치는 쓰지 않는다(이름만 비슷한 채널 방지)."""
    return {**CHANNELS, **extra_channels()}.get(normalize_channel(name))


def host_is_youtube(host):
    host = (host or '').lower()
    return any(host == d or host.endswith('.' + d) for d in YOUTUBE_HOSTS)


def video_id(url):
    """watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID 형식에서 영상 ID를 뽑는다. 영상이 아니면 None."""
    try:
        parts = urlsplit(str(url))
    except ValueError:
        return None
    if not host_is_youtube(parts.hostname):
        return None
    if (parts.hostname or '').lower().endswith('youtu.be'):
        cand = parts.path.strip('/').split('/')[0]
    elif parts.path == '/watch':
        cand = (parse_qs(parts.query).get('v') or [''])[0]
    else:
        pieces = parts.path.strip('/').split('/')
        cand = pieces[1] if len(pieces) >= 2 and pieces[0] in ('shorts', 'embed', 'live') else ''
    return cand if _ID.fullmatch(cand or '') else None


class YouTubeOEmbed:
    """유튜브 oEmbed로 영상 제목·채널명·썸네일을 확인한다. 실패하면 None."""

    def __init__(self):
        self.cache = {}

    async def fetch(self, vid):
        if vid in self.cache:
            return self.cache[vid]
        try:
            async with httpx.AsyncClient(timeout=6) as client:
                response = await client.get('https://www.youtube.com/oembed',
                    params={'url': 'https://www.youtube.com/watch?v=' + vid, 'format': 'json'})
                response.raise_for_status()
                data = response.json()
            result = {'title': str(data.get('title') or ''), 'channel': str(data.get('author_name') or ''),
                      'thumbnail': str(data.get('thumbnail_url') or '')}
        except Exception:
            result = None  # 비공개·삭제·네트워크 오류는 그냥 건너뛴다.
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[vid] = result
        return result


async def find_videos(search_videos, oembed, queries, relevant, limit=3, max_candidates=8, one_per_channel=False):
    """queries: [(종류, 검색어)]. 공식 채널 + relevant(kind, row) 통과 영상만 최대 limit개 돌려준다."""
    batches = await asyncio.gather(*(search_videos(q) for _, q in queries), return_exceptions=True)
    seen, candidates = set(), []
    for (kind, _), rows in zip(queries, batches):
        if isinstance(rows, Exception):
            continue
        for row in rows:
            vid = video_id(row.get('url'))
            if vid and vid not in seen:
                seen.add(vid)
                candidates.append((kind, vid, row))
    candidates = candidates[:max_candidates]
    infos = await asyncio.gather(*(oembed.fetch(vid) for _, vid, _ in candidates), return_exceptions=True)
    found = []
    for (kind, vid, row), info in zip(candidates, infos):
        if not info or isinstance(info, Exception):
            continue
        label = channel_label(info['channel'])
        merged = {**row, 'title': info['title'] or row.get('title') or ''}
        if label and one_per_channel and any(f['channel_label'] == label for f in found):
            continue  # 같은 채널 영상이 여러 개 나오면 다양한 채널을 보여 주려고 첫 영상만 쓴다
        if label and relevant(kind, merged):
            found.append({'video_id': vid, 'url': 'https://www.youtube.com/watch?v=' + vid, 'title': info['title'] or str(row.get('title') or ''),
                          'channel': info['channel'], 'channel_label': label, 'thumbnail': info['thumbnail'],
                          'published_at': row.get('published_date') if isinstance(row.get('published_date'), str) else None})
        if len(found) >= limit:
            break
    return found
