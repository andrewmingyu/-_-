import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from pydantic import BaseModel
from .models import (Article, ArticleAnalysis, Claim, Decision, Extraction, Source, RelatedArticle,
                     SourceFacts, SourceReviews, AnalyzeRequest, SelectionAnalysis, TextSpan,
                     CautionDetail, ArticleContext, EventInfo, PipelineError, SectionState, ReportComparisons,
                     HeadlineExplanation, Preview, Mention)
from .prompts import EXTRACT, TRACE, COMPARE_REPORTS
from .report_comparison import comparison_material, apply_comparisons
from .errors import ProviderError
from .outlets import domains_for, CRITIC_DOMAINS


logger = logging.getLogger('uvicorn.error')


class EnglishQuery(BaseModel):
    query: str
    document_title_en: str | None = None
    quotes_en: list[str] = []


class EnglishTitle(BaseModel):
    title_en: str | None = None


_QUOTED_TITLE = re.compile(r"[‘'“\"「『]([^’'”\"」』\n]{3,60})[’'”\"」』]\s*(?:이?라는|이?란)\s*(?:제목|표제|이름)")


def quoted_titles(text):
    """본문에서 'OOO'라는 제목 처럼 따옴표로 인용된 제목을 직접 뽑는다(추출 단계 결과가 실행마다 달라도 놓치지 않도록)."""
    found = []
    for title in _QUOTED_TITLE.findall(str(text or '')[:6000]):
        title = title.strip()
        if title and title not in found:
            found.append(title)
    return found[:3]


class OriginalJudgement(BaseModel):
    original_id: str | None = None
    reason: str = ''



def grounded_date(date, quote):
    """날짜가 원문 인용에 그대로 있거나, 날짜에 쓰인 숫자가 모두 원문에 있으면 인정한다 (예: 원문 'in 2007' → '2007년').
    숫자가 없는 날짜(예: '지난주')는 원문에 그대로 있을 때만 인정해 추정을 막는다."""
    date, quote = str(date or '').strip(), str(quote or '')
    if not date or date == '시점 미확인':
        return False
    if date in quote:
        return True
    numbers = re.findall(r'\d+', date)
    quote_numbers = set(re.findall(r'\d+', quote))
    # 영어 달 이름(March, Mar.)도 숫자로 본다: 원문 'March 12' → '3월 12일' 인정
    # 대문자로 시작하는 달 이름만 인정해 'may be'(~일지도) 같은 일반 단어를 달로 읽지 않는다
    months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    quote_numbers |= {str(i + 1) for i, m in enumerate(months) if re.search(r'\b' + m + r'[a-z]*\.?(?=\s*\d)', quote)}
    return bool(numbers) and all(n in quote_numbers or n.lstrip('0') in quote_numbers for n in numbers)


DATE_PATTERNS = [
    # 한국어: 2026년 11월 9일(현지시간), 11월 9일, 9일(현지 시간), 2007년, 지난 3월
    r'(?:\d{4}년\s*)?(?:\d{1,2}월\s*)?\d{1,2}일(?:\s*\(현지\s*시간\))?',
    r'\d{4}년(?:\s*\d{1,2}월)?',
    r'(?:지난|오는)\s*\d{1,2}월',
    # 영어: March 12, 2018 / Mar. 12 / 12 March 2018 / in 2007
    r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?',
    r'\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+\d{4})?',
    r'\b(?:19|20)\d{2}\b',
]


def date_in_quote(quote):
    """AI가 쓴 날짜가 원문에 없을 때, 원문 문장에 실제로 적힌 날짜 표현을 그대로 찾아 쓴다 (추정하지 않음)."""
    quote = str(quote or '')
    found = [(m.start(), m.group(0).strip()) for pattern in DATE_PATTERNS for m in re.finditer(pattern, quote)]
    if not found:
        return None
    first = min(pos for pos, _ in found)
    # 같은 위치에서 시작하는 표현 중 가장 긴 것 (예: '9일'보다 '11월 9일(현지시간)')
    text = max((text for pos, text in found if pos == first), key=len)
    return text + '년' if re.fullmatch(r'(?:19|20)\d{2}', text) else text


def timeline_date_key(date, published=None):
    """배경 및 맥락 정렬용 날짜 값 (연, 월, 일). 화면 표기는 바꾸지 않고 순서를 정할 때만 쓴다.
    '6일'·'지난 3월'처럼 연·월이 빠진 표현은 기사 작성일을 기준으로 채운다. 작성일보다 뒤의 날짜는 지난달·지난해로 보고,
    '오는'이 붙은 앞으로의 날짜는 이번 달·올해(지났으면 다음 달·내년)로 본다. 날짜가 없으면('시점 미확인') 화면의 '(보도일)'과 같이 작성일을 쓴다.
    알 수 없는 표현(예: '최근')은 None을 돌려줘 그 항목은 자리를 옮기지 않는다."""
    text = re.sub(r'[(（]?\s*(현지|한국)\s*시[각간]\s*(기준)?\s*[)）]?', ' ', str(date or '')).strip()
    pub = None
    if published:
        m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(published))
        pub = tuple(int(x) for x in m.groups()) if m else None
    if not text or text == '시점 미확인':
        return pub
    future = '오는' in text
    months = {m: i + 1 for i, m in enumerate(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])}
    m = re.search(r'(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})', text)
    if m:
        return tuple(int(x) for x in m.groups())
    m = re.search(r'\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?', text)
    if m and m.group(1).lower() in months:
        y = int(m.group(3)) if m.group(3) else (pub[0] if pub else None)
        return (y, months[m.group(1).lower()], int(m.group(2))) if y else None
    m = re.search(r'(\d{4})\s*년\s*(\d{1,2})\s*월', text)
    if m:
        return (int(m.group(1)), int(m.group(2)), 1)
    m = re.search(r'(\d{1,2})\s*월\s*(\d{1,2})\s*일', text)
    if m and pub:
        mo, d = int(m.group(1)), int(m.group(2)); y = pub[0]
        if not future and (mo, d) > pub[1:]: y -= 1
        if future and (mo, d) < pub[1:]: y += 1
        return (y, mo, d)
    m = re.search(r'(\d{1,2})\s*월', text)
    if m and pub:
        mo = int(m.group(1)); y = pub[0]
        if not future and mo > pub[1]: y -= 1
        if future and mo < pub[1]: y += 1
        return (y, mo, 1)
    m = re.search(r'(?<![\d년월])(\d{1,2})\s*일', text)
    if m and pub:
        d = int(m.group(1)); y, mo = pub[0], pub[1]
        if not future and d > pub[2]:
            y, mo = (y, mo - 1) if mo > 1 else (y - 1, 12)
        if future and d < pub[2]:
            y, mo = (y, mo + 1) if mo < 12 else (y + 1, 1)
        return (y, mo, d)
    m = re.search(r'(?<!\d)((?:19|20)\d{2})(?!\d)', text)
    if m:
        return (int(m.group(1)), 1, 1)
    return None


def order_timeline(items, published=None):
    """Gemini가 기사 서술 순서대로 돌려줘도 실제 일어난 순서로 다시 놓는다.
    날짜를 알 수 없는 항목은 제자리에 두고, 날짜가 같으면 원래 순서를 유지한다."""
    keys = [timeline_date_key(t.date, published) for t in items]
    slots = [i for i, k in enumerate(keys) if k is not None]
    ordered = sorted(slots, key=lambda i: (keys[i], i))
    result = list(items)
    for slot, src in zip(slots, ordered):
        result[slot] = items[src]
    return result


def grounded_name(name, text):
    """이름이 본문에 있으면 본문에 적힌 표기 그대로 돌려준다. 띄어쓰기만 다른 경우(예: '형사 1단독' ↔ '형사1단독')도 인정한다.
    본문에 없는 이름(AI 추정)은 None."""
    name = str(name or '').strip()
    if not name:
        return None
    if name in text:
        return name
    compact = re.sub(r'\s+', '', name)
    if len(compact) < 2:
        return None
    m = re.search(r'\s*'.join(map(re.escape, compact)), text)
    return m.group(0) if m else None


# 문장 끝이 이런 서술이면 문장 맨 앞의 주어가 그 내용을 말하거나 발표·판단한 주체다
SPEAKER_VERBS = r'(?:밝혔|말했|전했|설명했|지적했|강조했|선고했|명령했|판결했|발표했|주장했|반박했|덧붙였|예고했|답했|비판했|언급했|경고했|당부했|요구했|촉구했|결정했|판단했|부인했|인정했|약속했|보도했|해명했|공지했|통보했)다'
LEAD_WORDS = r'(?:특히|이에|또|또한|한편|아울러|이어|다만|앞서|이후|그러나|하지만|이와 관련해|이날|당시)'
PRONOUNS = {'그', '그녀', '이들', '그들', '이', '해당', '본인'}


def speaker_from_sentence(sentence):
    """주장 문장이 'OO은/는 … 밝혔다·선고했다'처럼 끝나면 문장 맨 앞의 주어를 발언자로 돌려준다.
    문장에 실제로 있는 글자만 쓰고, 수동형('조사됐다' 등)이나 대명사는 쓰지 않는다."""
    sentence = str(sentence or '').strip()
    if not re.search(SPEAKER_VERBS + r'[.”"\'’\s]*$', sentence):
        return None
    m = re.match(r'^(?:' + LEAD_WORDS + r'\s+)?(?:\d{1,2}일\s+)?([^\s"“”‘’\'(,][^"“”‘’\',]{0,38}?)(?:은|는)\s', sentence)
    if not m:
        return None
    name = m.group(1).strip()
    return None if name in PRONOUNS or len(name) < 2 else name


PRESS_SUFFIX = re.compile(r'(뉴스|일보|신문|방송|통신|경제|타임스|저널|TV|tv)$')


def attribution_before(text, quote):
    """주장 문장 바로 앞(같은 문장 안)에 'OO에 따르면'이 있으면 (원문 구절, 출처 이름)을 돌려준다. 예: '14일 연합뉴스에 따르면'."""
    start = text.find(quote)
    if start <= 0:
        return None
    head = text[max(0, start - 60):start]
    head = re.split(r'[.!?。\n]', head)[-1]
    m = re.search(r'((?:\d{1,2}일\s+)?([가-힣A-Za-z0-9·&\s]{2,30}?))에\s*따르면\s*$', head)
    if not m:
        return None
    phrase = head[m.start():].strip()
    name = re.sub(r'^\d{1,2}일\s+', '', m.group(1)).strip()
    return (phrase, name) if len(name) >= 2 and phrase in text else None


def attribution_near(text, quote, label, window=200):
    """출처 이름이 근거 인용 안에 있거나, 인용 바로 앞뒤(같은 문장 범위)에 있으면 인정한다.
    영어 기사처럼 '"…," says Prof X'로 발언자가 인용 뒤에 붙는 경우를 위해서다."""
    if label in quote:
        return True
    start = text.find(quote)
    if start < 0:
        return False
    return label in text[max(0, start - window):start + len(quote) + window]


def korean_translation(translation, original):
    """외국어 원문의 한국어 번역만 남긴다. 원문이 이미 한국어이거나 번역이 비었거나 한국어가 아니면 None."""
    text = ' '.join(str(translation or '').split())
    if not text or text == ' '.join(str(original or '').split()):
        return None
    hangul = lambda value: sum('가' <= ch <= '힣' for ch in value)
    letters = lambda value: sum(ch.isalpha() for ch in value) or 1
    if hangul(original or '') / letters(original or '') > 0.3:
        return None
    if hangul(text) / letters(text) < 0.3:
        return None
    return text[:600]

class ArticleInputError(ValueError):
    """Invalid user article input, distinct from provider/schema failures."""


def normalize_url(url):
    p = urlsplit(str(url))
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('HTTP(S) URL이 필요합니다.')
    query = sorted((k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith('utm_') and k != 'fbclid')
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or '/', urlencode(query), ''))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


@lru_cache(maxsize=1)
def publisher_names():
    path=Path(__file__).resolve().parents[2]/'newscheck 4/data/press.json'
    return {domain:item['name'] for domain,item in json.loads(path.read_text(encoding='utf-8'))['outlets'].items()}


TITLE_SUFFIX = re.compile(r'\s[-|–—]\s*([^-|–—]{2,40}?)\s*$')


def site_label(host):
    """도메인에서 언론사 이름 후보(두 번째 단계 이름)만 뽑는다. news.bbc.co.uk -> bbc"""
    parts=[p for p in host.lower().split('.') if p and p != 'www']
    while len(parts) > 1 and (parts[-1] in ('com','net','org','co','or','go','ne','kr','uk','jp','au','eu','cn','news') or len(parts[-1]) <= 2):
        parts.pop()
    return parts[-1] if parts else ''


def publisher_name(url, explicit=None, title=None):
    """언론사 이름: 검색 결과에 적힌 이름 > 팀 언론사 목록(press.json) > 제목 끝 '- 언론사명'(도메인과 맞을 때만) > 도메인"""
    if isinstance(explicit,str) and explicit.strip():
        return explicit.strip()
    host=(urlsplit(url).hostname or '').lower()
    domains=publisher_names()
    known=next((domains[d] for d in sorted(domains,key=len,reverse=True) if host==d or host.endswith('.'+d)),None)
    if known:
        return known
    match=TITLE_SUFFIX.search(str(title or ''))
    label=site_label(host)
    if match and label:
        suffix=match.group(1).strip()
        compact=re.sub(r'[^0-9a-z가-힣]','',suffix.lower())
        if len(label) >= 3 and (label in compact or (len(compact) >= 3 and compact in host.replace('.',''))):
            return suffix
    return re.sub(r'^www\.','',host) or None


def same_article(url, title, page_url, page_title):
    """검색 결과가 지금 읽는 기사 자신인지: 같은 주소(쿼리 차이 무시) 또는 같은 제목"""
    a, b = urlsplit(str(url)), urlsplit(str(page_url))
    if (a.hostname or '').removeprefix('www.') == (b.hostname or '').removeprefix('www.') and a.path.rstrip('/') == b.path.rstrip('/') and (not a.query or not b.query or a.query == b.query):
        return True
    core=lambda t: re.sub(r'\s*[-|–—]\s*[^-|–—]{2,40}$','',str(t or '')).strip()
    return bool(core(title)) and core(title) == core(page_title)


def iso_date(value):
    """검색 결과 날짜를 ISO 형식으로 통일 (예: 'Sat, 13 Jul 2019 10:00:00 GMT' -> '2019-07-13T10:00:00+00:00')"""
    if not value:
        return None
    text=str(value).strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}',text):
        return text
    try:
        return parsedate_to_datetime(text).isoformat()
    except (TypeError, ValueError, IndexError):
        return None


def body_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


def combine_decisions(decisions):
    status = 'caution' if any(d.status == 'caution' for d in decisions) else 'unknown' if not decisions or any(d.status == 'unknown' for d in decisions) else 'none_identified'
    reasons = list(dict.fromkeys(r for d in decisions for r in d.reasons))
    details = {}
    for decision in decisions:
        for detail in decision.details or [CautionDetail(reason=r) for r in decision.reasons]:
            item = details.setdefault(detail.reason, CautionDetail(reason=detail.reason))
            item.source_ids = list(dict.fromkeys(item.source_ids + detail.source_ids))
            item.claim_ids = list(dict.fromkeys(item.claim_ids + detail.claim_ids))
    return Decision(status=status, reasons=reasons or ['출처 분석에 필요한 정보가 부족합니다.'], details=list(details.values()))


FACT_LABELS = {'identity': '작성기관', 'authorship': '작성자', 'originality': '원자료 관계', 'expertise': '전문 분야',
    'information_access': '자료 접근 경로', 'date_context': '작성 시점', 'public_access': '공개 범위',
    'methodology': '조사 방법', 'interests': '이해관계', 'independence': '자료 독립성'}


_TITLE_STOP = frozenset('the and for with from that this about into over of in on at to a an is are was by'.split())


def title_matches(titles, page_title):
    """영어 원제 추정값의 핵심 단어(3개 이상)가 검색된 페이지 제목에 거의 다 들어 있을 때만 같은 자료로 본다.
    추정값은 번역이라 어순·관사가 달라질 수 있어 연속 문자열이 아니라 단어 포함률로 비교한다. 본문은 보지 않는다."""
    words = lambda x: [w for w in re.sub(r'[^a-z0-9가-힣]+', ' ', str(x or '').casefold()).split() if w not in _TITLE_STOP]
    page = set(words(page_title))
    for title in titles:
        ws = set(words(title))
        if len(ws) >= 3 and len(ws & page) / len(ws) >= 0.85:
            return True
    return False


def english_relevant(row, query_words):
    """영어 뉴스 검색 결과가 영어 검색어와 실제로 겹치는지 본다(핵심 단어 3개 이상, 40% 이상). 관련 없는 기사를 거른다."""
    if not query_words:
        return True
    text = f"{row.get('title') or ''} {str(row.get('content') or '')[:400]}".casefold()
    hit = query_words & set(re.findall(r'[a-z0-9]{3,}', text))
    return len(hit) >= 3 and len(hit) / len(query_words) >= 0.4


def title_overlap(row, title, minimum=1, chars=300):
    """검색 결과가 기사 제목의 핵심 단어를 minimum개 이상 담고 있는지 본다."""
    tokens = {w for w in re.findall(r'[0-9A-Za-z가-힣]{2,}', str(title or '').casefold())}
    text = f"{row.get('title') or ''} {str(row.get('content') or '')[:chars]}".casefold()
    return sum(1 for w in tokens if w in text) >= minimum


def text_coverage(quotes, content):
    """기사가 인용한 핵심 문장의 영어 번역 단어가 확보한 영어 본문에 얼마나 들어 있는지(0~1, 단어 6개 미만이면 0)."""
    words = lambda x: {w for w in re.sub(r'[^a-z0-9]+', ' ', str(x or '').casefold()).split() if len(w) >= 4 and w not in _TITLE_STOP}
    body = words(content)
    best = 0.0
    for quote in quotes:
        ws = words(quote)
        if len(ws) >= 6:
            best = max(best, len(ws & body) / len(ws))
    return best


def text_matches(quotes, content):
    return text_coverage(quotes, content) >= 0.7


def best_original(candidates, outlet_domains, titles, quotes):
    """공식 도메인의 제목·본문 유사성이 가장 높은 원문 후보를 고른다. 실제 인용/원본 확인은 별도다."""
    best, best_score = None, 0.0
    for c in candidates:
        host = (urlsplit(c['url']).hostname or '').lower()
        if not any(host == d or host.endswith('.' + d) for d in outlet_domains):
            continue
        score = 2.0 if title_matches(titles, c['title']) else text_coverage(quotes, c['content'])
        if score >= 0.7 and score > best_score:
            best, best_score = c['id'], score
    return best


def source_decision(status, facts, kind, published_at=None, reference_date=None):
    reasons = []
    if status == 'secondary_only':
        reasons.append('재인용 관계만 확인되어 원본 자료를 직접 확인하지 못했습니다.')
    if kind in ('statistics', 'research', '통계', '연구') and not facts.methodology:
        reasons.append('확보한 자료에서 조사·연구 방법을 확인하지 못했습니다.')
    if facts.interests and not re.search(r'이해관계\s*없|no conflicts? of interest', facts.interests.excerpt, re.I):
        reasons.append('자료 작성자의 이해관계 관련 문구를 확인했습니다: ' + facts.interests.excerpt)
    if published_at and reference_date:
        try:
            age = (datetime.fromisoformat(reference_date[:10]) - datetime.fromisoformat(published_at[:10])).days
            if age > 365:
                reasons.append(f'자료 발행일은 기사 작성일보다 {age}일 이전입니다. 최신 자료가 필요한지는 별도로 확인해 주세요.')
        except (ValueError, TypeError):
            pass
    missing = [FACT_LABELS[k] for k, v in facts.model_dump().items() if v is None]
    for label, value in [('자료 발행일', published_at), ('기사 작성일', reference_date)]:
        try:
            if not value:
                raise ValueError('missing date')
            datetime.fromisoformat(value[:10])
        except (ValueError, TypeError):
            missing.append(label)
    if reasons:
        return Decision(status='caution', reasons=reasons), missing
    if status != 'original_found' or missing:
        return Decision(status='unknown', reasons=['출처 속성을 확인하지 못했습니다: ' + ', '.join(missing)] if missing else ['원본 여부를 확인하지 못했습니다.']), missing
    return Decision(status='none_identified', reasons=['확보한 출처 정보에서 별도의 주의사항을 발견하지 못했습니다. 주장 진위의 판정은 아닙니다.']), missing


def claim_decision(claim, mentions, sources, search_status):
    reasons = []
    if claim.claim_type in ('opinion', 'interpretation', 'prediction'):
        reasons.append('의견·해석·예측에 해당하는 문장입니다. 사건의 발생 여부와 구분해 읽어야 합니다.')
    if not mentions or all(not m.source_label for m in mentions):
        reasons.append('이 주장에 연결된 근거의 출처가 기사에 명확히 제시되지 않았습니다.')
    if any(m.anonymous for m in mentions):
        reasons.append('익명 관계자 등의 발언으로 원출처를 추적하기 어렵습니다.')
    if claim.source_status == 'source_not_found':
        reasons.append('완료된 검색 범위에서 기사에 언급된 원출처를 찾지 못했습니다. 정보가 잘못되었다는 뜻은 아닙니다.')
    if claim.source_status == 'secondary_only':
        reasons.append('원자료를 직접 확인하지 못했고 재인용 자료만 찾았습니다.')
    decisions = [s.caution for s in sources]
    if reasons:
        decisions.append(Decision(status='caution', reasons=reasons))
    if search_status == 'failed':
        decisions.append(Decision(status='unknown', reasons=['원출처 검색 요청이 실패하여 분석이 불완전합니다.']))
    elif search_status == 'not_run':
        decisions.append(Decision(status='unknown', reasons=['기사에서 검색할 근거를 확보하지 못해 원출처 검색을 실행하지 않았습니다.']))
    elif claim.source_status == 'unknown':
        decisions.append(Decision(status='unknown', reasons=['검색된 자료와 기사 출처의 관계를 확인할 정보가 부족합니다.']))
    result = combine_decisions(decisions)
    for detail in result.details:
        detail.claim_ids = list(dict.fromkeys(detail.claim_ids + [claim.id]))
        if detail.reason in reasons:
            detail.source_ids = [s.id for s in sources]
    return result


def text_span(text, quote):
    start = text.find(quote) if quote else -1
    return TextSpan(start=start, end=start + len(quote), quote=quote) if start >= 0 else None


def clean_context(context, text):
    links = []
    seen = set()
    for link in context.cited_links:
        try:
            url = normalize_url(link.url)
        except ValueError:
            continue
        if url in seen or not link.text or link.text not in text:
            continue
        seen.add(url)
        links.append(type(link).model_validate({**link.model_dump(mode='json'),'url':url,
            'article_quote':link.article_quote if link.article_quote and link.article_quote in text else link.text}))
    return ArticleContext(cited_links=links, quotations=[q for q in context.quotations if q and q in text], body_truncated=context.body_truncated)


class Analyzer:
    def __init__(self, llm, search, mode='live', ttl=900, official=None):
        if mode == 'mock':
            from .mock import MockLLM, MockSearch
            llm, search, official = MockLLM(), MockSearch(), None
        self.llm, self.search, self.mode, self.ttl = llm, search, mode, ttl
        self.official = official  # 공식 공시 조회(DART 등). 없으면 건너뛴다.
        self.cache, self.inflight = {}, {}
        self.extractions, self.extracting = {}, {}

    def cache_key(self, request, focus=None):
        # Metadata/title are included so corrections cannot reuse an old presentation.
        metadata = request.metadata.model_dump(mode='json') if request.metadata else None
        if metadata:
            metadata['url'] = normalize_url(request.url)
        return body_hash(json.dumps([normalize_url(request.url), body_hash(request.page_text),
            request.title, metadata, clean_context(request.article_context,request.page_text).model_dump(mode='json'),
            self.mode, os.getenv('LLM_MODEL'), 'source-tracing-v1.12', focus], ensure_ascii=False))

    def lookup(self, article_id, url=None):
        url = normalize_url(url) if url is not None else None
        for key, (expires, result) in list(self.cache.items()):
            if expires <= time.monotonic():
                self.cache.pop(key, None)
                continue
            if result.article_id == article_id and (url is None or normalize_url(result.article.url) == url):
                return result.model_copy(deep=True)
        return None

    async def analyze(self, request, focus=None):
        if not request.page_text.strip():
            raise ArticleInputError('기사 본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.')
        request = request.model_copy(update={'article_context':clean_context(request.article_context,request.page_text)})
        try:
            key = self.cache_key(request, focus)
        except ValueError as exc:
            raise ArticleInputError('사용자 정보가 없는 HTTP(S) 기사 URL이 필요합니다.') from exc
        cached = self.cache.get(key)
        if not request.refresh and cached and cached[0] > time.monotonic():
            return cached[1].model_copy(deep=True)
        if key not in self.inflight:
            self.inflight[key] = asyncio.create_task(self._run(request, key, focus))
        task = self.inflight[key]
        try:
            result = await asyncio.shield(task)
            if result.search_status != 'failed' and not result.search_errors:
                if len(self.cache) >= 128:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (time.monotonic() + self.ttl, result)
            return result.model_copy(deep=True)
        finally:
            if task.done():
                self.inflight.pop(key, None)
                self.extractions.pop(key, None)

    async def _extract(self, request, key, focus=None):
        cached = self.extractions.get(key)
        if not request.refresh and cached and cached[0] > time.monotonic():
            return cached[1].model_copy(deep=True)
        if key not in self.extracting:
            self.extracting[key] = asyncio.create_task(self._extract_once(request,focus))
        task = self.extracting[key]
        try:
            extracted = await asyncio.shield(task)
            if len(self.extractions) >= 128 and key not in self.extractions:
                self.extractions.pop(next(iter(self.extractions)))
            self.extractions[key] = (time.monotonic()+self.ttl,extracted)
            return extracted.model_copy(deep=True)
        finally:
            if task.done():
                self.extracting.pop(key,None)

    async def _extract_once(self,request,focus=None):
        instruction = EXTRACT
        if focus:
            instruction += '\nselected_text에 해당하는 주장만 추출하라. 발언자와 기사 근거를 이해할 때 body의 주변 문맥을 참고하라.'
        extracted = await self.llm.generate(instruction, {'title': request.title, 'body': request.page_text, 'selected_text': focus,
            'article_context':request.article_context.model_dump(mode='json')}, Extraction)
        extracted = self.clean_extraction(extracted,request.page_text)
        # 배경 및 맥락은 기사에 나온 순서가 아니라 일어난 순서로 보여 준다
        extracted.context_timeline = order_timeline(extracted.context_timeline, request.metadata.published_at if request.metadata else None)
        return extracted

    async def preview(self,request):
        if not request.page_text.strip():
            raise ArticleInputError('기사 본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.')
        request = request.model_copy(update={'article_context':clean_context(request.article_context,request.page_text)})
        try:
            key = self.cache_key(request)
        except ValueError as exc:
            raise ArticleInputError('사용자 정보가 없는 HTTP(S) 기사 URL이 필요합니다.') from exc
        cached = self.cache.get(key)
        if not request.refresh and cached and cached[0] > time.monotonic():
            a = cached[1]
            return Preview(article_id=a.article_id,is_demo=a.is_demo,summary=a.one_line_summary,
                major_evidence=a.evidence_mentions[:2],sources=a.sources,headline_difference=a.headline_difference,
                one_line_caution=a.caution.reasons[0],search_status=a.search_status,claims=a.claims[:2],
                body_hash=a.body_hash,data_version=a.data_version,pipeline_errors=a.pipeline_errors)
        extracted = await self._extract(request,key)
        return Preview(article_id=key[:24],is_demo=self.mode=='mock',summary=extracted.summary,
            major_evidence=[],sources=[],headline_difference=extracted.headline_difference,
            one_line_caution='기사 본문만 요약한 미리보기입니다. 출처 확인은 상세 분석에서 진행합니다.',
            search_status='not_run',body_hash=body_hash(request.page_text))

    async def _english_query(self, request, mentions):
        """국내 기사가 외국 출처를 다룰 때를 위해 영어 검색어를 한 번 만든다. 실패하면 None."""
        if not (request.title or '').strip() or request.title.isascii():
            return None, [], []
        titles_ko = list(dict.fromkeys([m.document_title for m in mentions if m.document_title] + quoted_titles(request.page_text)))[:3]
        try:
            out = await self.llm.generate('한국어 기사가 외국 언론·기관의 보도나 보고서를 인용하고 있다. 기사 제목, 출처명, 인용 문장을 보고 '
                '그 원문 보도의 영어 제목이나 핵심 문장을 추정해 영어 뉴스 검색어(고유명사 영문 표기 포함, 15단어 이하)로 만들어라. '
                'quoted_titles(본문에 따옴표로 인용된 제목, 예: \'21세기 정치적 도박\')가 하나라도 있으면 그 영어 원제를 우선 사용하고 document_title_en을 반드시 채워라. 또 외국 매체의 보도 내용으로 인용된 핵심 문장 1~3개를 원문이 쓰였을 영어로 옮겨 quotes_en에 적어라. 사실을 추가하지 마라.',
                {'title': request.title, 'sources': [m.source_label for m in mentions if m.source_label][:3],
                 'quoted_titles': titles_ko, 'article_head': request.page_text[:600],
                 'quotes': [m.article_quote[:200] for m in mentions][:3]}, EnglishQuery)
        except Exception:
            return None, [], []
        text = getattr(out, 'query', None)
        title_en = getattr(out, 'document_title_en', None)
        titles = [title_en.strip()] if isinstance(title_en, str) and title_en.strip() else []
        if not titles and titles_ko:
            # AI가 영어 원제를 비워 두면 인용된 제목만 따로 번역해 다시 받는다(영어 원제가 원문 검색의 가장 확실한 단서다).
            try:
                tr = await self.llm.generate('다음은 한국 기사가 외국 매체 보도의 제목으로 인용한 한국어 제목이다. 그 보도의 원래 영어 제목으로 옮겨 title_en에 적어라. 모르면 null로 둔다.',
                                             {'titles': titles_ko, 'article_title': request.title}, EnglishTitle)
                value = getattr(tr, 'title_en', None) if isinstance(tr, EnglishTitle) else None
                if isinstance(value, str) and value.strip():
                    titles = [value.strip()]
            except Exception:
                pass
        logger.info('영어 검색어: %s / 영어 원제: %s', (text or '없음') if isinstance(text, str) else '없음', titles[0] if titles else '없음')
        quotes = [q for q in (getattr(out, 'quotes_en', None) or []) if isinstance(q, str) and q.strip()][:3]
        return (' '.join(text.split())[:150] if isinstance(text, str) and text.strip() else None), titles, quotes

    async def _judge_original(self, request, candidates, outlet_domains, hints=(), prefer=None):
        """영어 제목 추정이 틀려도 원문을 찾도록, 기사가 언급한 매체 도메인 후보 중 '같은 보도'인 것을 LLM에 한 번 묻는다.
        결과는 비교 대상 후보일 뿐이며 인용 관계·원본 확인으로 승격하지 않는다.
        (판정을 했는지, 고른 id) 를 돌려준다. 판정에 실패했으면 (False, None), 판정했지만 맞는 보도가 없으면 (True, None)."""
        if os.getenv('ORIGINAL_JUDGE', 'on').strip().lower() in ('off', 'false', '0') or not outlet_domains:
            return False, None
        # 본문 추출이 실패한 페이지도 검색 요약(snippet)이 있으면 판정 대상에 올린다.
        pool = [c for c in candidates if (c['content'] or c.get('snippet')) and any(
            (urlsplit(c['url']).hostname or '').lower() in (d,) or (urlsplit(c['url']).hostname or '').lower().endswith('.' + d)
            for d in outlet_domains)]
        # 같은 매체 페이지가 많을 수 있어, 영어 검색어·제목 단어와 가장 많이 겹치는 후보 4개만 판정에 올린다.
        words = {w for w in re.findall(r'[a-z0-9]{3,}', ' '.join(hints).casefold()) if w not in _TITLE_STOP}
        score = lambda c: len(words & set(re.findall(r'[a-z0-9]{3,}', (c['title'] + ' ' + (c['content'] or c.get('snippet') or '')[:800]).casefold())))
        pool = sorted(pool, key=lambda c: (c['id'] != prefer, -score(c)))[:4]
        if not pool:
            logger.info('원문 후보 판정: 매체 도메인 후보가 없어 건너뜁니다.')
            return False, None
        try:
            out = await self.llm.generate('한국어 기사가 외국 매체·기관의 보도를 옮겨 전하고 있다. candidates 중 이 기사가 옮긴 바로 그 보도(같은 사건, '
                '같은 발언·주장이 실려 있는 원문)가 있으면 그 id를 original_id에 적어라. 같은 주제의 다른 기사이거나 확신이 없으면 null로 두어라. '
                'reason에는 두 글이 같은 보도라고 본 근거를 한 문장으로 적어라. 사실을 추가하지 마라.',
                {'article_title': request.title, 'article_body': request.page_text[:1500],
                 'candidates': [{'id': c['id'], 'url': c['url'], 'title': c['title'], 'text': (c['content'] or c.get('snippet') or '')[:1500]} for c in pool]},
                OriginalJudgement)
        except Exception:
            return False, None
        if not isinstance(out, OriginalJudgement):
            return False, None
        picked = getattr(out, 'original_id', None)
        picked = picked if picked in {c['id'] for c in pool} else None
        logger.info('원문 후보 판정: 후보 %d개(%s) → %s', len(pool), ', '.join(urlsplit(c['url']).path[-30:] for c in pool),
                    next((c['url'] for c in pool if c['id'] == picked), '없음'))
        return True, picked

    async def _run(self, request, key, focus=None):
        extracted = await self._extract(request,key,focus)
        if focus:
            extracted.claims = [c for c in extracted.claims if focus in c.original_text or c.original_text in focus]
            extracted.headline_explanation = HeadlineExplanation()
            ids = {c.id for c in extracted.claims}
            scoped_ids = {c.id:'selection_'+key[:10]+'_'+c.id for c in extracted.claims}
            for claim in extracted.claims:
                claim.id = scoped_ids[claim.id]
            for mention in extracted.evidence_mentions:
                mention.claim_ids = [scoped_ids[i] for i in mention.claim_ids if i in ids]
            extracted.evidence_mentions = [m for m in extracted.evidence_mentions if m.claim_ids]
        claims, mentions = extracted.claims, extracted.evidence_mentions
        candidates, search_errors, pipeline_errors = {}, [], []
        def record_error(exc, phase, provider):
            error = exc if isinstance(exc,ProviderError) else ProviderError('provider_error',provider)
            pipeline_errors.append(PipelineError(phase=phase, code=error.code, provider=error.provider,
                message=error.message,retry_after_seconds=error.retry_after_seconds))
        queries = list(dict.fromkeys(' '.join(filter(None, [m.source_label, m.document_title, m.article_quote[:120]])) for m in mentions))[:3]
        for link in request.article_context.cited_links:
            # 포털의 검색 결과 페이지 링크는 출처 자료가 아니므로 검색어로 쓰지 않는다.
            if (urlsplit(str(link.url)).hostname or '').startswith('search.') or urlsplit(str(link.url)).path.startswith('/search'):
                continue
            if any(link.text in m.article_quote for m in mentions):
                query = str(link.url) + ' ' + link.text
                if query not in queries:
                    queries.insert(0,query)
        queries = queries[:3]
        # 관련 기사 검색은 원출처 검색과 서로 기다릴 필요가 없으므로 먼저 시작해 둔다.
        related_task = asyncio.ensure_future(self.search.search(request.title[:200], topic='news')) if request.title and not focus else None
        # 기사가 특정 언론사·기관을 언급할 때만 그 도메인 안에서 추가 검색한다(크레딧 절약).
        mention_text = ' '.join(filter(None, [f'{m.source_label or ""} {m.document_title or ""} {m.article_quote}' for m in mentions]))
        own_host = (urlsplit(str(request.url)).hostname or '').lower()
        # 기사를 낸 매체 자신의 도메인은 제외한다(자기 사이트를 다시 검색해도 같은 기사만 나온다).
        named_domains = [d for d in domains_for(f'{request.title or ""} {mention_text} {request.page_text[:3000]}')
                         if not (own_host == d or own_host.endswith('.' + d))]
        english, english_titles, english_quotes = await self._english_query(request, mentions) if os.getenv('ENGLISH_SEARCH', 'on').strip().lower() not in ('off', 'false', '0') else (None, [], [])
        if english and english not in queries:
            queries.append(english)
        # 외신 보도도 관련 기사 후보에 들어오도록 같은 영어 검색어로 뉴스 검색을 한 번 더 한다.
        related_en_task = asyncio.ensure_future(self.search.search(english, topic='news')) if english and related_task else None
        # 이 기사에 대한 정정·반박·논란을 다룬 후속 보도도 관련 기사 후보에 넣는다(끄려면 FOLLOWUP_SEARCH=off).
        related_follow_task = asyncio.ensure_future(self.search.search(request.title[:120] + ' 논란 정정 반박', topic='news')) \
            if related_task and os.getenv('FOLLOWUP_SEARCH', 'on').strip().lower() not in ('off', 'false', '0') else None
        # 영어 검색어 하나만으로는 원문이 안 잡히는 일이 있어, 인용된 영어 원제와 핵심 인용문으로도 매체 도메인 안에서만 더 찾는다(검색 2회 이하).
        scoped_extra = []
        if named_domains and getattr(self.search, 'search_in', None):
            for text in list(english_titles)[:1] + list(english_quotes)[:1]:
                text = ' '.join(str(text).split())[:150]
                if text and text != english and text not in scoped_extra:
                    scoped_extra.append(text)
        # 기사가 언급한 매체의 보도를 더 집중적으로 찾는다: 그 매체 도메인 안에서 기사 제목(과 영어 검색어)으로 관련 기사를 검색한다(끄려면 OUTLET_FOCUS=off).
        scoped_search = getattr(self.search, 'search_in', None)
        outlet_tasks = []
        if named_domains and scoped_search and related_task and os.getenv('OUTLET_FOCUS', 'on').strip().lower() not in ('off', 'false', '0'):
            for kind, text in (('outlet_ko', request.title[:120]), ('outlet_en', english)):
                if text:
                    outlet_tasks.append((kind, asyncio.ensure_future(scoped_search(text, named_domains))))
        # 이 기사를 비평·정정한 글(미디어 비평 매체)을 그 매체 도메인 안에서만 찾는다(끄려면 CRITIC_SEARCH=off).
        own_publisher = publisher_name(str(request.url), None, request.title) or ''
        critic_task = None
        if named_domains and scoped_search and related_task and os.getenv('CRITIC_SEARCH', 'on').strip().lower() not in ('off', 'false', '0'):
            critic_domains = [d for d in CRITIC_DOMAINS if not (own_host == d or own_host.endswith('.' + d))]
            critic_task = asyncio.ensure_future(scoped_search(
                ' '.join(filter(None, [own_publisher, request.title[:80], '기사 왜곡 지적 비판'])), critic_domains))
        async def fetch(query, scoped_only=False):
            try:
                rows = [] if scoped_only else await self.search.search(query)
            except Exception as exc:
                return None, exc
            extra = getattr(self.search, 'search_in', None)
            if extra and named_domains:
                try:
                    rows = list(rows) + list(await extra(query, named_domains))
                except Exception:
                    pass  # 보조 검색 실패는 원출처 검색 상태에 영향을 주지 않는다.
            return rows, None
        # 검색어마다 순서대로 기다리지 않고 한꺼번에 실행한다(결과는 검색어 순서대로 처리).
        fetched = await asyncio.gather(*(fetch(q) for q in queries), *(fetch(q, True) for q in scoped_extra))
        batches = list(zip(queries + scoped_extra, fetched))
        if self.official:
            try:  # 공식 자료 조회 실패는 원출처 검색 상태에 영향을 주지 않는다.
                batches.append((None, (await self.official.search(request.title, request.page_text), None)))
            except Exception:
                pass
        for query, (rows, exc) in batches:
            if exc is not None:
                record_error(exc, 'source_search', 'tavily')
                search_errors.append('원출처 검색 요청이 실패했습니다. 다시 시도할 수 있습니다.')
                continue
            for row in rows:
                try:
                    url = normalize_url(row['url'])
                except (ValueError, KeyError, TypeError):
                    continue
                if url == normalize_url(request.url):
                    continue
                content = row.get('raw_content') or ''
                candidate = {'id': 'src_' + body_hash(url)[:16], 'url': url,
                    'title': str(row.get('title') or ''), 'content': str(content)[:16000],
                    'snippet': str(row.get('content') or '')[:2000],
                    'published_at': row.get('published_date') if isinstance(row.get('published_date'), str) else None, 'retrieved_at': now_iso(),
                    'content_status':'retrieved' if content else 'snippet_only'}
                # Search snippets are discovery hints, not full primary-source observations.
                if url not in candidates or len(candidate['content']) > len(candidates[url]['content']):
                    candidates[url] = candidate
        search_status = 'failed' if search_errors else 'completed' if queries else 'not_run'
        # 원문 추출은 3건까지만 되므로, 기사가 언급한 매체 도메인 자료를 먼저 가져온다.
        outlet_first = lambda u: not any((urlsplit(u).hostname or '').lower() == d or (urlsplit(u).hostname or '').lower().endswith('.' + d) for d in named_domains)
        pending = sorted([c['url'] for c in candidates.values() if not c['content']], key=outlet_first)[:3]
        if pending and hasattr(self.search,'extract'):
            try:
                documents = await self.search.extract(pending)
                for document in documents:
                    try:
                        url = normalize_url(document['url'])
                    except (ValueError,KeyError,TypeError):
                        continue
                    if url in pending and isinstance(document.get('raw_content'),str) and document['raw_content']:
                        candidates[url]['content'] = document['raw_content'][:16000]
                        candidates[url]['content_status'] = 'retrieved'
                missing = [u for u in pending if not candidates[u]['content']]
                if missing:
                    # 추출이 일시적으로 비는 일이 있어 한 번만 다시 요청한다.
                    try:
                        for document in await self.search.extract(missing):
                            try:
                                url = normalize_url(document['url'])
                            except (ValueError,KeyError,TypeError):
                                continue
                            if url in missing and isinstance(document.get('raw_content'),str) and document['raw_content']:
                                candidates[url]['content'] = document['raw_content'][:16000]
                                candidates[url]['content_status'] = 'retrieved'
                    except Exception:
                        pass
                if any(not candidates[url]['content'] for url in pending):
                    search_errors.append('일부 검색 자료의 원문을 확보하지 못했습니다. 검색 요약과 구분합니다.')
                    pipeline_errors.append(PipelineError(phase='document_fetch',code='document_unavailable',message=search_errors[-1],provider='tavily'))
            except Exception as exc:
                record_error(exc,'document_fetch','tavily')
                search_errors.append('검색된 자료의 원문 확보 요청이 실패했습니다.')
                for url in pending:
                    candidates[url]['content_status'] = 'unavailable'
        reviews = SourceReviews(sources=[])
        if candidates:
            try:
                reviews = await self.llm.generate(TRACE, {'mentions': [m.model_dump() for m in mentions],
                    'sources': list(candidates.values())}, SourceReviews)
            except Exception as exc:
                record_error(exc,'source_review','gemini')
                search_errors.append('출처 속성 정리를 완료하지 못했습니다. 원본 여부를 보류합니다.')
        sources = self.build_sources(mentions, list(candidates.values()), reviews,
            request.metadata.published_at if request.metadata else None, request.article_context, english_titles, english_quotes, named_domains)
        for timeline in extracted.context_timeline:
            timeline.source_ids = [s.id for s in sources if any(m.id in s.mention_ids and m.article_quote in timeline.article_quote for m in mentions)]
        for claim in claims:
            own_mentions = [m for m in mentions if claim.id in m.claim_ids]
            claim.mention_ids = [m.id for m in own_mentions]
            own_sources = [s for s in sources if set(s.mention_ids) & set(claim.mention_ids)]
            claim.source_ids = [s.id for s in own_sources]
            if any(s.original_status == 'original_found' for s in own_sources):
                claim.source_status = 'original_found'
            elif search_status == 'failed':
                claim.source_status = 'unknown'
            elif any(s.original_status == 'secondary_only' for s in own_sources):
                claim.source_status = 'secondary_only'
            elif own_sources or search_errors or not own_mentions:
                claim.source_status = 'unknown'
            else:
                claim.source_status = 'source_not_found' if search_status == 'completed' else 'unknown'
            claim.caution = claim_decision(claim, own_mentions, own_sources, search_status)
        for reason in extracted.headline_explanation.reasons:
            reason.source_ids = [s.id for s in sources if set(s.mention_ids) & set(reason.mention_ids)]
        decision = combine_decisions([c.caution for c in claims])
        if request.article_context.body_truncated:
            decision = combine_decisions([decision,Decision(status='caution',reasons=['본문 길이 제한으로 추출된 앞부분만 분석했습니다. 전체 기사를 추가 확인해 주세요.'])])
        if search_errors:
            decision = combine_decisions([decision, Decision(status='unknown', reasons=search_errors)])
        related, report_materials = [], {}
        if request.title and not focus:
            try:
                rows = list(await related_task)
                extra_rows = []
                en_words = {w for w in re.findall(r'[a-z0-9]{3,}', ' '.join([english or ''] + list(english_titles)).casefold())
                            if w not in _TITLE_STOP}
                for kind, task in (('en', related_en_task), ('follow', related_follow_task)):
                    if task:
                        try:
                            got = list(await task)
                            # 영어·후속 보도 검색은 엉뚱한 기사가 섞이기 쉬워 관련도가 낮은 결과를 걸러낸다.
                            got = [r for r in got if (english_relevant(r, en_words) if kind == 'en' else title_overlap(r, request.title))]
                            extra_rows.append(got)
                        except Exception:
                            pass  # 영어·후속 보도 검색 실패는 한국어 관련 기사 결과에 영향을 주지 않는다.
                outlet_rows = []
                for kind, task in outlet_tasks:
                    try:
                        got = list(await task)
                        got = [r for r in got if (english_relevant(r, en_words) if kind == 'outlet_en' else title_overlap(r, request.title, 2))]
                        outlet_rows.append(got)
                    except Exception:
                        pass  # 매체 도메인 검색 실패는 일반 관련 기사 결과에 영향을 주지 않는다.
                if critic_task:
                    try:
                        # 비평 매체 안에서도 이 기사와 무관한 글이 섞일 수 있어, 기사 제목의 핵심 단어 2개 이상이 제목·요약에 있는 것만 쓴다.
                        outlet_rows.insert(0, [r for r in await critic_task if title_overlap(r, request.title, 2, 800)])
                    except Exception:
                        pass  # 비평 매체 검색 실패는 일반 관련 기사 결과에 영향을 주지 않는다.
                # 언급된 매체의 보도를 맨 앞에, 이어서 한국어·영어·후속 보도를 번갈아 배치해 상위 5건·비교 3건 안에 들어가게 한다.
                lists = outlet_rows + [rows] + extra_rows
                rows = [r for i in range(max(len(x) for x in lists)) for x in lists for r in x[i:i+1]]
                hosts = set()
                for row in rows:
                    try:
                        url = normalize_url(row['url'])
                    except (KeyError, TypeError, ValueError):
                        continue
                    publisher=publisher_name(url,row.get('publisher'),row.get('title'))
                    host = publisher or urlsplit(url).hostname
                    if host in hosts or url == normalize_url(request.url) or same_article(url,row.get('title'),request.url,request.title):
                        continue
                    hosts.add(host)
                    report_id = 'report_' + body_hash(url)[:16]
                    material, basis = comparison_material(row)
                    report_materials[report_id] = material
                    related.append(RelatedArticle(id=report_id, url=url, title=str(row.get('title') or ''),
                        publisher=publisher, published_at=iso_date(row.get('published_date')),
                        topic=request.title, summary=str(row.get('content') or '')[:400] or None,
                        comparison_basis=basis,
                        differences_summary='검색 결과 요약(기사 본문 비교 전): ' + str(row.get('content') or '내용 차이 미확인')[:250]))
                    if len(related) == 5:
                        break
            except Exception as exc:
                record_error(exc,'related_search','tavily')
                search_errors.append('관련 기사 검색이 실패했습니다. 원출처 검색 상태와는 별개입니다.')
        # 유사성으로 찾은 외신 자료는 후보일 뿐이다. 검증된 인용 관계와 분리해 비교 대상으로 보존한다.
        by_id = {c['id']: c for c in candidates.values()}
        original_ids = set()
        candidate_id = best_original(list(candidates.values()), named_domains, english_titles, english_quotes)
        # 영어 원제가 페이지 제목과 맞는 경우만 강한 근거로 본다. 인용문 단어 일치만으로 고른 후보는 같은 매체의 다른 기사일 수 있다.
        strong = bool(candidate_id) and title_matches(english_titles, by_id[candidate_id]['title'])
        if candidate_id:
            logger.info('원문 후보: %s로 선택 → %s', '제목 일치' if strong else '인용문 단어 일치(약한 근거)', by_id[candidate_id]['url'])
        elif not focus:
            outlet_pages = [c for c in candidates.values() if any((urlsplit(c['url']).hostname or '').lower().endswith(d) for d in named_domains)]
            logger.info('원문 후보: 제목·인용문 일치 없음 (매체 도메인 후보 %d개, 본문 확보 %d개, 영어 원제 %s)',
                        len(outlet_pages), sum(1 for c in outlet_pages if c['content']), (english_titles or ['없음'])[0])
        if not strong and not focus:
            judged_ok, judged = await self._judge_original(request, list(candidates.values()), named_domains,
                                                           [english or ''] + list(english_titles), prefer=candidate_id)
            if judged:
                candidate_id = judged
            elif judged_ok:
                candidate_id = None  # 약한 근거로 고른 후보를 AI가 같은 보도가 아니라고 하면 버린다
        for s in sorted(sources, key=lambda s:s.id != candidate_id):
            cand = by_id.get(s.id)
            verified = s.discovery == 'article_cited' and s.original_status == 'original_found' and bool(s.mention_ids)
            if cand and cand['content'] and s.id == candidate_id:
                row = {'url': cand['url'], 'title': cand['title'], 'content': cand['snippet'], 'raw_content': cand['content']}
                report_id = 'report_' + body_hash(cand['url'])[:16]
                material, basis = comparison_material(row)
                material = cand['content'][:16000]  # 원문은 결론 부분까지 비교하도록 더 길게 쓴다.
                report_materials[report_id] = material
                related = [r for r in related if normalize_url(r.url) != cand['url']]
                related.insert(0, RelatedArticle(id=report_id, url=cand['url'], title=cand['title'] or cand['url'],
                    publisher=publisher_name(cand['url'],None,cand['title']), published_at=iso_date(cand['published_at']),
                    topic=request.title, summary=cand['snippet'][:400] or None, comparison_basis=basis,
                    original_candidate=not verified,
                    differences_summary='원본 확인 자료(비교 전).' if verified else '원문 후보(인용 관계 미확인, 비교 전).'))
                if verified:original_ids.add(report_id)
                del related[5:]
                break
        if related:
            comparison_reports = related[:3]
            try:
                comparisons = await self.llm.generate(COMPARE_REPORTS, {
                    'body': request.page_text,
                    'reports': [{'id': r.id, 'title': r.title, 'basis': r.comparison_basis, 'is_original': r.id in original_ids,
                                 'is_original_candidate': r.original_candidate,
                                 'text': report_materials[r.id]} for r in comparison_reports],
                }, ReportComparisons)
                cited_urls={normalize_url(link.url) for link in request.article_context.cited_links}
                cited_urls.update(normalize_url(s.url) for s in sources if s.discovery=='article_cited' and s.original_status=='original_found')
                apply_comparisons(comparison_reports, report_materials, request.page_text, comparisons,
                    cited_report_ids={r.id for r in comparison_reports if normalize_url(r.url) in cited_urls})
            except Exception as exc:
                record_error(exc, 'related_comparison', 'gemini')
                search_errors.append('다른 보도와의 비교를 완료하지 못했습니다. 관련 기사 목록은 유지합니다.')
                for report in comparison_reports:
                    report.comparison_status = 'failed'
                    report.comparison_points = []
                    report.differences_summary = '보도 비교를 완료하지 못했습니다. 원문을 직접 확인해 주세요.'
        metadata = request.metadata or Article(url=request.url, title=request.title)
        metadata = Article.model_validate({**metadata.model_dump(mode='json'),'url':normalize_url(request.url),'title':request.title or metadata.title,
            'event_time':extracted.event.time or metadata.event_time,'event_location':extracted.event.location or metadata.event_location})
        states = {
            'context':SectionState(status='ready' if extracted.context_timeline or extracted.event.description else 'empty',message=None if extracted.context_timeline or extracted.event.description else '기사에서 확인한 배경 정보가 없습니다.'),
            'metadata':SectionState(status='ready'),
            'claims':SectionState(status='ready' if claims else 'empty',message=None if claims else '원문과 연결된 주장을 추출하지 못했습니다.'),
            'evidence':SectionState(status='error' if any(e.phase in ('source_search','document_fetch','source_review') for e in pipeline_errors) else 'partial' if not sources or any(s.unknown_fields for s in sources) else 'ready'),
            'cautions':SectionState(status='partial' if decision.status=='unknown' else 'ready'),
            'related':SectionState(status='error' if any(e.phase=='related_search' for e in pipeline_errors) else 'partial' if related and any(r.comparison_status!='compared' for r in related) else 'ready' if related else 'empty')}
        return ArticleAnalysis(article_id=key[:24], body_hash=body_hash(request.page_text),
            analysis_status='partial' if request.article_context.body_truncated or search_errors or decision.status == 'unknown' or any(s.unknown_fields for s in sources) else 'complete',
            is_demo=self.mode=='mock', article=metadata, one_line_summary=extracted.summary, claims=claims, evidence_mentions=mentions,
            headline_explanation=extracted.headline_explanation,
            context_timeline=extracted.context_timeline, sources=sources, caution=decision, related_articles=related,
            headline_difference=extracted.headline_difference, search_status=search_status, search_errors=search_errors,
            final_comment=('규칙·fixture 기반 시연용 분석입니다. ' if self.mode=='mock' else '')+'출처 확인이나 주의사항 부재는 주장 진실성의 입증이 아닙니다.', analyzed_at=now_iso(),
            event=extracted.event, article_context=request.article_context, section_states=states, pipeline_errors=pipeline_errors)

    @staticmethod
    def clean_extraction(extracted, text):
        # Reject hallucinated quotations, speakers and article-attributed sources.
        claims, seen = [], set()
        for c in extracted.claims:
            if c.id in seen or not c.original_text or c.original_text not in text:
                continue
            seen.add(c.id)
            c.claim_text = c.original_text
            c.translation = korean_translation(c.translation, c.original_text)
            # 발언자: AI가 쓴 이름을 본문 표기로 맞추고, 비어 있으면 문장 맨 앞의 주어에서 찾는다 (본문에 없는 이름은 쓰지 않음)
            given = c.speaker
            c.speaker = grounded_name(given, text)
            if given and not c.speaker:
                logger.info('발언자 제거(본문에 없음): %s', given)
            if not c.speaker:
                c.speaker = speaker_from_sentence(c.original_text)
            c.source_ids, c.mention_ids, c.source_status = [], [], 'unknown'
            c.caution = Decision(reasons=['출처 분석 전입니다.'])
            c.article_span = text_span(text,c.original_text)
            claims.append(c)
        ids = {c.id for c in claims}
        mentions, seen = [], set()
        for m in extracted.evidence_mentions:
            if m.id in seen or not m.article_quote or m.article_quote not in text:
                continue
            seen.add(m.id)
            m.claim_ids = [i for i in m.claim_ids if i in ids]
            m.description = m.article_quote
            m.translation = korean_translation(m.translation, m.article_quote)
            m.source_label = m.source_label if m.source_label and attribution_near(text, m.article_quote, m.source_label) else None
            m.document_title = m.document_title if m.document_title and m.document_title in text else None
            m.anonymous = bool(re.search(r'익명|관계자|소식통', m.article_quote))
            m.article_span = text_span(text,m.article_quote)
            mentions.append(m)
        # 주장 문장 바로 앞에 'OO에 따르면'이 있는데 근거로 뽑히지 않았으면 그 구절을 근거(출처)로 추가한다
        for c in claims:
            found = attribution_before(text, c.original_text)
            if not found or any(c.id in m.claim_ids and found[0] in m.article_quote for m in mentions):
                continue
            phrase, name = found
            same = next((m for m in mentions if m.article_quote == phrase), None)
            if same:
                same.claim_ids = list(dict.fromkeys([*same.claim_ids, c.id]))
                continue
            mentions.append(Mention(id='m_attr_' + c.id, claim_ids=[c.id], description=phrase, article_quote=phrase, source_label=name,
                source_kind='news_report' if PRESS_SUFFIX.search(name) else 'unknown', article_span=text_span(text, phrase)))
        extracted.claims, extracted.evidence_mentions = claims, mentions
        extracted.context_timeline = [t.model_copy(update={'description':t.article_quote, 'article_span':text_span(text,t.article_quote),
            'date':t.date if grounded_date(t.date, t.article_quote) else (date_in_quote(t.article_quote) or '시점 미확인'),'source_ids':[]}) for t in extracted.context_timeline if t.article_quote and t.article_quote in text]
        event = extracted.event
        if not event.article_quote or event.article_quote not in text:
            extracted.event = EventInfo()
        else:
            event.description = event.article_quote
            event.time = event.time if grounded_date(event.time, event.article_quote) else date_in_quote(event.article_quote)
            event.location = event.location if event.location and event.location in event.article_quote else None
        event = extracted.event
        matching = [i for i,t in enumerate(extracted.context_timeline) if event.article_quote and
                    (event.article_quote in t.article_quote or t.article_quote in event.article_quote)]
        marked = [i for i,t in enumerate(extracted.context_timeline) if t.is_main_event]
        main = matching[0] if matching else marked[0] if marked else None
        for i,t in enumerate(extracted.context_timeline):
            t.is_main_event = i == main
        mids = {m.id for m in mentions}
        reasons = []
        for reason in extracted.headline_explanation.reasons:
            if not reason.article_quote or reason.article_quote not in text:
                continue
            reason.claim_ids = list(dict.fromkeys([i for i in reason.claim_ids if i in ids] +
                [c.id for c in claims if c.original_text in reason.article_quote or reason.article_quote in c.original_text]))
            reason.mention_ids = list(dict.fromkeys([i for i in reason.mention_ids if i in mids] +
                [m.id for m in mentions if set(m.claim_ids) & set(reason.claim_ids) or
                 m.article_quote in reason.article_quote or reason.article_quote in m.article_quote]))
            reason.source_ids = []
            reason.article_span = text_span(text,reason.article_quote)
            reasons.append(reason)
        extracted.headline_explanation = (HeadlineExplanation(meaning=extracted.headline_explanation.meaning,reasons=reasons)
            if reasons and extracted.headline_explanation.meaning else HeadlineExplanation())
        return extracted

    @staticmethod
    def build_sources(mentions, candidates, reviews, reference_date=None, article_context=None, english_titles=(), english_quotes=(), outlet_domains=()):
        allowed_mentions = {m.id: m for m in mentions}
        # Duplicate reviews are not allowed to overwrite an earlier observation.
        by_id = {}
        for r in reviews.sources:
            if r.source_id not in by_id:
                by_id[r.source_id] = r
        sources = []
        for c in candidates:
            review = by_id.get(c['id'])
            facts = SourceFacts()
            mids = [m.id for m in mentions if any(normalize_url(link.url)==c['url'] and link.text in m.article_quote for link in (article_context.cited_links if article_context else []))]
            status = 'unknown'
            # 공식 도메인/추정 번역의 단어 유사성만으로 기사 인용 또는 원본 확인으로 승격하지 않는다.
            if review:
                facts = SourceFacts(**{k: v for k, v in review.facts.model_dump().items()
                    if v and v['excerpt'] in c['content']})
                for mid in review.mention_ids:
                    mention = allowed_mentions.get(mid)
                    if not mention:
                        continue
                    # A subject match alone does not establish an article citation.
                    direct_link = any(normalize_url(link.url)==c['url'] and link.text in mention.article_quote for link in (article_context.cited_links if article_context else []))
                    if direct_link:
                        mids.append(mid)
                    elif mention.document_title:
                        if mention.document_title in (c['title'] + c['content']):
                            mids.append(mid)
                    elif mention.source_label and facts.identity and mention.source_label in facts.identity.excerpt and mention.article_quote in c['content']:
                        mids.append(mid)
                if mids and facts.originality:
                    status = review.original_status
                    if status == 'original_found' and not facts.identity:
                        status = 'unknown'
            decision, missing = source_decision(status, facts, next((allowed_mentions[i].source_kind for i in mids), 'unknown'), c['published_at'], reference_date)
            decision.details = [CautionDetail(reason=r,source_ids=[c['id']]) for r in decision.reasons]
            sources.append(Source(id=c['id'], url=c['url'], title=c['title'],
                publisher=facts.identity.excerpt if facts.identity else None,
                author=facts.authorship.excerpt if facts.authorship else None,
                published_at=c['published_at'], retrieved_at=c['retrieved_at'],
                discovery='article_cited' if mids else 'external_found', mention_ids=list(dict.fromkeys(mids)),
                source_kind=next((allowed_mentions[i].source_kind for i in mids), 'unknown'), original_status=status,
                facts=facts, unknown_fields=missing, summary=('작성기관 표기: ' + facts.identity.excerpt + '. ' if facts.identity else '작성기관 표기를 확인하지 못했습니다. ')
                    + ('추가 확인 항목: ' + ', '.join(missing) if missing else '공개된 출처 속성을 정리했습니다. 주장 진위의 판정은 아닙니다.'), caution=decision,
                content_status=c.get('content_status','retrieved' if c['content'] else 'snippet_only')))
        return sources

    async def selection(self, request):
        if request.selected_text not in request.page_text:
            raise ArticleInputError('선택 문장이 전달된 기사 본문에 없습니다.')
        if request.context_scope=='page_excerpt':
            scoped=AnalyzeRequest(**request.model_dump(exclude={'article_id','selected_text','surrounding_text','context_scope'}))
            scoped.article_context.body_truncated=True
            analysis=await self.analyze(scoped,focus=request.selected_text)
            return SelectionAnalysis(article_id=analysis.article_id,selected_text=request.selected_text,is_demo=analysis.is_demo,
                claims=analysis.claims,sources=analysis.sources,caution=analysis.caution,pipeline_errors=analysis.pipeline_errors,
                analysis_id=analysis.article_id,evidence_mentions=analysis.evidence_mentions,context_scope='page_excerpt')
        analysis = await self.analyze(AnalyzeRequest(**request.model_dump(exclude={'article_id', 'selected_text', 'surrounding_text','context_scope'})))
        if request.article_id and request.article_id != analysis.article_id:
            raise ArticleInputError('현재 기사와 분석 ID가 다릅니다. 기사를 다시 분석해 주세요.')
        matches = [c for c in analysis.claims if c.original_text in request.selected_text]
        if not matches and len(request.selected_text)>=12:
            partial=[c for c in analysis.claims if request.selected_text in c.original_text]
            if len(partial)==1:
                matches=partial
        matched_ids=[c.id for c in matches]
        if not matches:
            # A new selection is traced separately, preserving whole-article cached output.
            local = await self.analyze(AnalyzeRequest(url=request.url, title=request.title,
                page_text=request.page_text, metadata=request.metadata, article_context=request.article_context), focus=request.selected_text)
            matches, analysis_sources, selection_errors = local.claims, local.sources, local.pipeline_errors
            selection_id, mentions = local.article_id, local.evidence_mentions
        else:
            analysis_sources, selection_errors = analysis.sources, analysis.pipeline_errors
            selection_id, mentions = analysis.article_id, analysis.evidence_mentions
        source_ids = {i for c in matches for i in c.source_ids}
        mention_ids = {i for c in matches for i in c.mention_ids}
        return SelectionAnalysis(article_id=analysis.article_id, selected_text=request.selected_text, is_demo=analysis.is_demo,
            claims=matches, sources=[s for s in analysis_sources if s.id in source_ids],
            caution=combine_decisions([c.caution for c in matches]), pipeline_errors=selection_errors,
            analysis_id=selection_id, matched_claim_ids=matched_ids, evidence_mentions=[m for m in mentions if m.id in mention_ids])
