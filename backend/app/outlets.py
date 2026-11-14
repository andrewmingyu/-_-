"""언론사·기관 이름 → 도메인 매핑. 기사가 특정 기관을 언급할 때만 그 도메인 안에서 추가 검색한다."""
import json
import re
from functools import lru_cache
from pathlib import Path

OUTLETS = {
    'reuters': ['reuters.com'], '로이터': ['reuters.com'],
    'ap': ['apnews.com'], 'associated press': ['apnews.com'], 'ap통신': ['apnews.com'],
    'bbc': ['bbc.com', 'bbc.co.uk'], 'cnn': ['cnn.com'], 'bloomberg': ['bloomberg.com'], '블룸버그': ['bloomberg.com'],
    'new york times': ['nytimes.com'], '뉴욕타임스': ['nytimes.com'], 'nyt': ['nytimes.com'],
    'washington post': ['washingtonpost.com'], '워싱턴포스트': ['washingtonpost.com'],
    'wall street journal': ['wsj.com'], 'wsj': ['wsj.com'], '월스트리트저널': ['wsj.com'],
    'financial times': ['ft.com'], '파이낸셜타임스': ['ft.com'], 'guardian': ['theguardian.com'], '가디언': ['theguardian.com'],
    'forbes': ['forbes.com'], '포브스': ['forbes.com'], 'cnbc': ['cnbc.com'], 'variety': ['variety.com'],
    'hollywood reporter': ['hollywoodreporter.com'], 'tmz': ['tmz.com'], 'snopes': ['snopes.com'],
    'nvidia': ['nvidia.com', 'blogs.nvidia.com'], '엔비디아': ['nvidia.com', 'blogs.nvidia.com'],
    '연합뉴스': ['yna.co.kr'], 'kbs': ['kbs.co.kr'], 'mbc': ['imnews.imbc.com'], 'sbs': ['news.sbs.co.kr'],
    '통계청': ['kostat.go.kr', 'kosis.kr'], '국가데이터처': ['kostat.go.kr', 'kosis.kr'],
    '금융감독원': ['fss.or.kr', 'dart.fss.or.kr'], '한국은행': ['bok.or.kr'], '질병관리청': ['kdca.go.kr'],
    '식품의약품안전처': ['mfds.go.kr'], '식약처': ['mfds.go.kr'],
    '조선일보': ['chosun.com'], '중앙일보': ['joongang.co.kr'], '동아일보': ['donga.com'], '한겨레': ['hani.co.kr'],
    '경향신문': ['khan.co.kr'], '한국일보': ['hankookilbo.com'], '매일경제': ['mk.co.kr'], '한국경제': ['hankyung.com'],
    '서울경제': ['sedaily.com'], '오마이뉴스': ['ohmynews.com'], '뉴시스': ['newsis.com'], '뉴스1': ['news1.kr'],
    'ytn': ['ytn.co.kr'], 'jtbc': ['jtbc.co.kr'], '연합뉴스tv': ['yonhapnewstv.co.kr'], '세계일보': ['segye.com'],
    '국민일보': ['kmib.co.kr'], '문화일보': ['munhwa.com'], '서울신문': ['seoul.co.kr'], '시사in': ['sisain.co.kr'],
    '프레시안': ['pressian.com'], '코리아헤럴드': ['koreaherald.com'], '코리아타임스': ['koreatimes.co.kr'],
    # 인물·기관이 SNS 글로 직접 한 말은 그 SNS가 기사에 언급될 때만 해당 서비스 안에서 찾는다.
    '트위터': ['x.com', 'twitter.com'], 'twitter': ['x.com', 'twitter.com'],
    '페이스북': ['facebook.com'], 'facebook': ['facebook.com'],
    '스레드': ['threads.com', 'threads.net'], 'threads': ['threads.com', 'threads.net'],
    '인스타그램': ['instagram.com'], 'instagram': ['instagram.com'],
}

# 언론 보도를 비평·검증하는 매체. 기사가 언급한 외신·기관을 다룰 때 이 도메인 안에서만 "이 기사에 대한 지적"을 따로 찾는다.
CRITIC_DOMAINS = ['ohmynews.com', 'mediatoday.co.kr', 'pressian.com', 'newstapa.org', 'journalist.or.kr', 'sisain.co.kr']


@lru_cache
def extra_outlets():
    # 팀이 `foreign_press.json`({"이름": ["도메인", ...]})에 항목을 추가하면 코드 수정 없이 반영된다.
    path = Path(__file__).with_name('foreign_press.json')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {str(k).casefold(): [d for d in v if isinstance(d, str)] for k, v in data.items() if isinstance(v, list)}


def domains_for(text):
    """text(출처명·본문 일부)에 언급된 언론사·기관의 도메인. 언급이 없으면 빈 목록."""
    low = (text or '').casefold()
    found = []
    for name, domains in {**OUTLETS, **extra_outlets()}.items():
        if name.isascii():
            # 영문 이름은 앞뒤가 영문·숫자가 아닐 때만 일치한다. "BBC는"은 일치하고 "MAP"의 "ap"는 일치하지 않는다.
            hit = re.search(r'(?<![a-z0-9])' + re.escape(name) + r'(?![a-z0-9])', low)
        else:
            hit = name in low
        if hit:
            found += [d for d in domains if d not in found]
    return found[:10]
