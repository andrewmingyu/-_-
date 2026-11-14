import json
import logging
import os
import re
import time
import httpx
from urllib.parse import urlsplit
from pydantic import ValidationError
from .errors import ProviderError, retry_after
from .prompts import SYSTEM

logger = logging.getLogger('uvicorn.error')

# 한도 초과·일시 장애·모델 미지원일 때만 다음 모델로 넘어간다.
# 인증·권한·결제 문제는 어느 모델이든 같으므로 바로 알린다.
FALLBACK_CODES = frozenset({'rate_limited', 'timeout', 'provider_unavailable',
                            'request_not_found', 'invalid_request', 'invalid_response'})
# LLM_FALLBACK_MODELS를 비워 두면 쓰는 기본 순서. 계정에서 쓸 수 없는 모델(404)은 자동으로 건너뛴다.
DEFAULT_FALLBACK_MODELS = ('gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash')
# 기사 근거를 찾기 좋은 공식 사이트(정부·통계·공시·법령)를 먼저, 그다음 유튜브·네이버.
DEFAULT_EXTRA_DOMAINS = 'korea.kr,kosis.kr,dart.fss.or.kr,law.go.kr,go.kr,youtube.com,naver.com'
MODEL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
ATTEMPT_TIMEOUT_SECONDS = 45
TOTAL_BUDGET_SECONDS = 90
# 실패한 모델을 잠시 건너뛰는 시간(초). 429에 Retry-After가 있으면 그 값을 쓴다.
COOLDOWN_SECONDS = {'rate_limited': 60, 'provider_unavailable': 30, 'timeout': 30,
                    'request_not_found': 3600, 'invalid_request': 600, 'invalid_response': 120}


def model_chain(environ=None):
    """LLM_MODEL을 먼저, 그 뒤에 LLM_FALLBACK_MODELS(없으면 기본 목록)를 중복 없이 나열한다."""
    environ = os.environ if environ is None else environ
    primary = (environ.get('LLM_MODEL') or '').strip()
    raw = (environ.get('LLM_FALLBACK_MODELS') or '').strip()
    if raw.casefold() in ('off', 'none', 'false', '0'):
        extra = []
    elif raw:
        extra = [item.strip() for item in raw.split(',')]
    else:
        extra = list(DEFAULT_FALLBACK_MODELS)
    chain = []
    for model in [primary, *extra]:
        if model and MODEL_ID.fullmatch(model) and model not in chain:
            chain.append(model)
    return chain


def max_attempts(environ=None):
    environ = os.environ if environ is None else environ
    try:
        return min(6, max(1, int(environ.get('LLM_MAX_ATTEMPTS') or 3)))
    except ValueError:
        return 3


def strip_server_fields(data):
    """서버가 직접 채우는 필드(claims[].caution)는 모델이 빈 문자열을 넣어도 검증에서 제외한다."""
    if isinstance(data, dict) and isinstance(data.get('claims'), list):
        for claim in data['claims']:
            if isinstance(claim, dict):
                claim.pop('caution', None)
    return data

def provider_failure(exc, provider):
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return ProviderError('timeout', provider)
    if isinstance(exc, (ValidationError, ValueError)):
        return ProviderError('invalid_response', provider)
    status = getattr(exc, 'code', None) or getattr(getattr(exc, 'response', None), 'status_code', None)
    try:
        status = int(status)
    except (TypeError, ValueError):
        status = None
    headers = getattr(getattr(exc, 'response', None), 'headers', {}) or {}
    if status == 429:
        return ProviderError('rate_limited', provider, retry_after(headers.get('Retry-After')))
    if status in (408,504):
        return ProviderError('timeout',provider)
    if status in (400,401,402,403,404):
        code = {400:'invalid_request',401:'authentication_failed',402:'billing_required',
                403:'permission_denied',404:'request_not_found'}[status]
        return ProviderError(code, provider)
    if status in (500,502,503):
        return ProviderError('provider_unavailable', provider, retry_after(headers.get('Retry-After')))
    if isinstance(exc, httpx.RequestError):
        return ProviderError('network_error', provider)
    return ProviderError('provider_error', provider)

class Gemini:
    def __init__(self):
        self._cooldown = {}  # 모델 ID -> 이 시각(monotonic)까지는 건너뛴다

    def _ordered(self, chain):
        now = time.monotonic()
        ready = [m for m in chain if self._cooldown.get(m, 0) <= now]
        cooling = sorted((m for m in chain if m not in ready), key=lambda m: self._cooldown[m])
        return ready + cooling

    def _cool(self, model, error):
        seconds = COOLDOWN_SECONDS.get(error.code, 30)
        if error.code == 'rate_limited' and error.retry_after_seconds is not None:
            seconds = min(900, error.retry_after_seconds)
        self._cooldown[model] = time.monotonic() + max(5, seconds)

    async def _call(self, key, model, instruction, payload, schema, timeout_ms):
        from google import genai
        from google.genai import types
        async with genai.Client(api_key=key, http_options={'timeout': timeout_ms, 'retry_options': {'attempts': 1}}).aio as client:
            response = await client.models.generate_content(
                model=model, contents=instruction + '\nDATA:\n' + json.dumps(payload, ensure_ascii=False),
                config=types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0,
                    response_mime_type='application/json', response_json_schema=schema.model_json_schema()))
        return schema.model_validate(strip_server_fields(json.loads(response.text or '')))

    async def generate(self, instruction, payload, schema):
        key = os.getenv('GEMINI_API_KEY')
        chain = model_chain()
        if not key or not (os.getenv('LLM_MODEL') or '').strip() or not chain:
            raise ProviderError('configuration_missing', 'gemini')
        started = time.monotonic()
        failures = []
        for model in self._ordered(chain):
            if len(failures) >= max_attempts():
                break
            elapsed = time.monotonic() - started
            if failures and elapsed >= TOTAL_BUDGET_SECONDS:
                break
            timeout_ms = int(min(ATTEMPT_TIMEOUT_SECONDS, max(10, TOTAL_BUDGET_SECONDS - elapsed)) * 1000)
            try:
                result = await self._call(key, model, instruction, payload, schema, timeout_ms)
            except ImportError:
                raise
            except Exception as exc:
                error = provider_failure(exc, 'gemini')
                if error.code not in FALLBACK_CODES:
                    raise error from exc
                self._cool(model, error)
                failures.append(error)
                # 모델 ID와 오류 코드만 기록한다 (키·본문·공급자 원문은 남기지 않는다).
                logger.warning('Gemini 모델 %s 실패(%s)', model, error.code)
                continue
            if failures:
                logger.warning('Gemini 모델 %s(으)로 전환해 처리했습니다.', model)
            return result
        # 모델 미지원(404)보다 한도·장애 같은 실제 원인을 먼저 알려 준다.
        raise next((e for e in failures if e.code != 'request_not_found'), failures[-1])


class Tavily:
    async def search_dictionary(self,term):
        from .words import DICTIONARY_HOSTS
        return await self._request('search',{'query':term+' 사전 뜻','topic':'general','max_results':3,
            'include_raw_content':True,'include_answer':False,'search_depth':'basic','include_domains':list(DICTIONARY_HOSTS)})

    async def _request(self, endpoint, payload):
        key = os.getenv('TAVILY_API_KEY')
        if not key:
            raise ProviderError('configuration_missing', 'tavily')
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                response = await client.post('https://api.tavily.com/' + endpoint,
                    headers={'Authorization': f'Bearer {key}'}, json=payload)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data.get('results'), list):
                    raise ValueError('Invalid provider response')
                return data['results']
        except Exception as exc:
            raise provider_failure(exc, 'tavily') from exc

    @staticmethod
    def depth():
        # TAVILY_SEARCH_DEPTH=basic 으로 낮추면 크레딧을 아낄 수 있다.
        return 'basic' if (os.getenv('TAVILY_SEARCH_DEPTH') or '').strip().lower() == 'basic' else 'advanced'

    @staticmethod
    def extra_domains():
        raw = (os.getenv('SEARCH_EXTRA_DOMAINS') or DEFAULT_EXTRA_DOMAINS).strip()
        if raw.casefold() in ('off', 'none', 'false', '0'):
            return []
        pattern = re.compile(r'[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+')
        return [d for d in dict.fromkeys(x.strip().lower() for x in raw.split(',')) if pattern.fullmatch(d)][:20]

    @staticmethod
    def log_search(kind, query, depth, rows):
        # 검색이 실제로 실행됐는지 터미널에서 볼 수 있게 한다. 검색어는 앞 40자만, 결과는 도메인만 남긴다.
        if (os.getenv('SEARCH_LOG') or '').strip().lower() in ('off', 'false', '0'):
            return
        hosts = []
        for row in rows:
            try:
                host = urlsplit(str(row.get('url'))).hostname
            except (ValueError, AttributeError):
                host = None
            if host and host not in hosts:
                hosts.append(host)
        short = ' '.join(str(query).split())[:40]
        logger.info('Tavily 검색[%s·%s] "%s…" → %d건 %s', kind, depth, short, len(rows), ', '.join(hosts[:6]))

    async def search(self, query, topic='general'):
        # 뉴스 검색(관련 기사 비교)은 빠른 basic, 원출처 검색은 설정된 깊이를 쓴다.
        depth = 'basic' if topic == 'news' else self.depth()
        rows = await self._request('search', {'query': query, 'topic': topic, 'max_results': 5,
            'include_raw_content': True, 'include_answer': False, 'search_depth': depth})
        self.log_search('뉴스' if topic == 'news' else '일반', query, depth, rows)
        return rows

    async def search_in(self, query):
        """유튜브·네이버 등 지정한 사이트 안에서만 한 번 더 검색한다. 도메인이 없으면 빈 목록."""
        domains = self.extra_domains()
        if not domains:
            return []
        rows = await self._request('search', {'query': query, 'topic': 'general', 'max_results': 5,
            'include_raw_content': True, 'include_answer': False, 'search_depth': self.depth(),
            'include_domains': domains})
        self.log_search('지정 사이트', query, self.depth(), rows)
        return rows

    async def extract(self, urls):
        # Called only for URLs already returned by search; the server never fetches arbitrary URLs.
        rows = await self._request('extract', {'urls': urls[:3], 'include_images': False})
        if (os.getenv('SEARCH_LOG') or '').strip().lower() not in ('off', 'false', '0'):
            logger.info('Tavily 원문 추출 요청 %d건 → %d건 확보', len(urls[:3]), len(rows))
        return rows
