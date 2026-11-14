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
}


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
