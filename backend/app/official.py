"""공식 공시 자료(금융감독원 DART) 직접 조회.

기사에 언급된 상장사의 최근 공시 목록을 가져와 원출처 후보로 추가한다.
공시 목록의 메타데이터(제출인·보고서명·접수일)만 사용하며, 기사 내용의 진위를 판단하지 않는다.
DART_API_KEY가 없으면 아무것도 하지 않는다.
"""
import asyncio
import io
import logging
import os
import re
import time
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET
import httpx
from .clients import provider_failure
from .errors import ProviderError

logger = logging.getLogger('uvicorn.error')
BASE = 'https://opendart.fss.or.kr/api'
CORP_TTL_SECONDS = 24 * 3600
LOOKBACK_DAYS = 180
MAX_COMPANIES = 2
PAGE_COUNT = 5
# OpenDART 응답 status → 우리 오류 코드 (공식 안내의 대표 코드만 매핑하고 나머지는 일반 오류로 둔다)
STATUS_CODES = {'010': 'authentication_failed', '011': 'authentication_failed', '012': 'permission_denied',
                '020': 'rate_limited', '800': 'provider_unavailable', '900': 'provider_error'}


def parse_corps(zip_bytes):
    """corpCode.xml(zip)에서 상장사(종목코드가 있는 회사)의 {회사명: 고유번호}만 뽑는다."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            name = next(n for n in archive.namelist() if n.lower().endswith('.xml'))
            root = ET.fromstring(archive.read(name))
    except (zipfile.BadZipFile, StopIteration, ET.ParseError) as exc:
        raise ProviderError('invalid_response', 'dart') from exc
    corps = {}
    for item in root.iter('list'):
        corp_name = (item.findtext('corp_name') or '').strip()
        corp_code = (item.findtext('corp_code') or '').strip()
        stock_code = (item.findtext('stock_code') or '').strip()
        if corp_name and len(corp_code) == 8 and stock_code:
            corps.setdefault(corp_name, corp_code)
    return corps


def find_companies(title, text, corps, limit=MAX_COMPANIES):
    """제목·본문에 이름이 나오는 상장사를 고른다. 짧은 이름과 본문에 한 번만 나온 이름은 오인 위험이 커서 제외한다."""
    title, text = title or '', text or ''
    scored = []
    for name in corps:
        if len(name) < 3:
            continue
        in_title, in_body = title.count(name), text.count(name)
        if not in_title and in_body < 2:
            continue
        scored.append((3 * in_title + in_body, len(name), name))
    chosen = []
    for _, _, name in sorted(scored, reverse=True):
        # 이미 고른 더 긴 이름의 일부이면 건너뛴다(예: '삼성전자' 안의 '삼성').
        if any(name in other for other in chosen):
            continue
        chosen.append(name)
        if len(chosen) == limit:
            break
    return chosen


def disclosure_rows(corp_name, items):
    rows = []
    for item in sorted(items, key=lambda i: str(i.get('rcept_dt') or ''), reverse=True):
        rcept_no = str(item.get('rcept_no') or '')
        report = str(item.get('report_nm') or '').strip()
        raw_date = str(item.get('rcept_dt') or '')
        if not re.fullmatch(r'\d{14}', rcept_no) or not report:
            continue
        iso = f'{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}' if re.fullmatch(r'\d{8}', raw_date) else None
        filer = str(item.get('flr_nm') or '').strip()
        content = f'{corp_name}의 공시: {report}. 접수일 {iso or "미확인"}.' + (f' 제출인 {filer}.' if filer else '')
        rows.append({'url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}',
                     'title': f'{corp_name} - {report}', 'content': content, 'raw_content': content,
                     'published_date': iso})
    return rows


class Dart:
    def __init__(self):
        self._corps, self._loaded_at = None, 0.0
        self._lock = asyncio.Lock()

    @staticmethod
    def key():
        return (os.getenv('DART_API_KEY') or '').strip()

    async def _get(self, path, params):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.get(BASE + '/' + path, params=params)
                response.raise_for_status()
                return response
        except Exception as exc:
            raise provider_failure(exc, 'dart') from exc

    async def corps(self, key):
        async with self._lock:
            if self._corps is not None and time.monotonic() - self._loaded_at < CORP_TTL_SECONDS:
                return self._corps
            response = await self._get('corpCode.xml', {'crtfc_key': key})
            content = response.content
            if not content.startswith(b'PK'):
                # 키 오류 등은 zip이 아니라 XML 오류 응답으로 온다.
                try:
                    status = ET.fromstring(content).findtext('status') or ''
                except ET.ParseError:
                    status = ''
                raise ProviderError(STATUS_CODES.get(status, 'invalid_response'), 'dart')
            self._corps, self._loaded_at = parse_corps(content), time.monotonic()
            logger.info('DART 상장사 목록 %d곳을 불러왔습니다.', len(self._corps))
            return self._corps

    async def search(self, title, text):
        key = self.key()
        if not key:
            return []
        names = find_companies(title, text, await self.corps(key))
        if not names:
            return []
        today = date.today()
        rows = []
        for name in names:
            response = await self._get('list.json', {
                'crtfc_key': key, 'corp_code': self._corps[name], 'page_count': PAGE_COUNT,
                'bgn_de': (today - timedelta(days=LOOKBACK_DAYS)).strftime('%Y%m%d'), 'end_de': today.strftime('%Y%m%d')})
            data = response.json()
            status = str(data.get('status') or '')
            if status == '013':  # 조회된 데이터 없음
                continue
            if status != '000':
                raise ProviderError(STATUS_CODES.get(status, 'provider_error'), 'dart')
            rows += disclosure_rows(name, data.get('list') or [])
        logger.info('DART 공시 조회 [%s] → %d건', ', '.join(names), len(rows))
        return rows