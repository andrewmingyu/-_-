"""Safe setup check. Network calls require --live or --list-models explicitly."""
import argparse
import asyncio
import os
from pathlib import Path
import re
import sys
from typing import Literal

from dotenv import dotenv_values, load_dotenv
from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.clients import Gemini, Tavily, provider_failure

ENV_PATH = ROOT / 'backend/.env'
REQUIRED = ('GEMINI_API_KEY', 'LLM_MODEL', 'TAVILY_API_KEY')


class ConnectionReply(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['ok']


def configured(value):
    if not isinstance(value, str) or not value.strip():
        return False
    value = value.strip().casefold()
    return not any(marker in value for marker in (
        '발급받', '여기에', '계정에서', 'your_api', 'your_key', 'your_model', '<', '>',
    ))


def read_settings(path=ENV_PATH, environ=None):
    values = dotenv_values(path) if path.exists() else {}
    environ = os.environ if environ is None else environ
    return {name: environ.get(name, values.get(name, ''))
            for name in ('ANALYSIS_MODE', *REQUIRED)}


async def check_live(llm=None, search=None, *, provider='both'):
    # One small structured generation and one search; no article content or key is printed.
    llm, search = llm or Gemini(), search or Tavily()
    succeeded = True
    providers = ('gemini', 'tavily') if provider == 'both' else (provider,)
    for provider in providers:
        try:
            print('[진행] ' + provider + ' 응답을 기다리는 중입니다.', flush=True)
            if provider == 'gemini':
                response = await llm.generate(
                    'API 연결 시험이다. status가 ok인 JSON 객체만 반환하라.',
                    {'task': 'connection_check'}, ConnectionReply,
                )
                ConnectionReply.model_validate(response)
                print('[PASS] Gemini: 요청 및 간단한 구조화 응답 확인')
            else:
                results = await search.search('site:docs.tavily.com Tavily Search API')
                if not isinstance(results, list):
                    raise ValueError('Invalid response')
                print(f'[PASS] Tavily: 검색 요청 확인, 결과 {len(results)}건')
        except Exception as exc:
            error = provider_failure(exc, provider)
            delay = f' ({error.retry_after_seconds}초 후 재시도)' if error.retry_after_seconds is not None else ''
            print(f'[FAIL] {provider}: {error.code} · {error.message}{delay}')
            succeeded = False
    return 0 if succeeded else 1


async def list_models():
    from google import genai
    try:
        async with genai.Client(api_key=os.getenv('GEMINI_API_KEY'), http_options={'timeout': 20000}).aio as client:
            count = 0
            async for model in await client.models.list():
                actions = model.supported_actions or []
                if 'generateContent' not in actions or not re.fullmatch(r'models/[A-Za-z0-9._-]+', model.name or ''):
                    continue
                print(model.name.removeprefix('models/'))
                count += 1
                if count >= 40:
                    break
            print(f'생성 요청 지원 모델 {count}개 표시. 구조화 응답 지원은 --live에서 따로 확인합니다.')
            return 0 if count else 1
    except Exception as exc:
        error = provider_failure(exc, 'gemini')
        print(f'[FAIL] Gemini 모델 목록: {error.code} · {error.message}')
        return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--live', action='store_true', help='실제 Gemini 1회·Tavily 1회 호출 (사용량 발생)')
    group.add_argument('--list-models', action='store_true', help='Gemini API에 모델 목록 요청; 콘텐츠 생성은 하지 않음')
    parser.add_argument('--provider', choices=('both', 'gemini', 'tavily'), default='both',
                        help='--live에서 검사할 공급자. 기본은 둘 다')
    args = parser.parse_args(argv)
    settings = read_settings()
    mode = settings['ANALYSIS_MODE']
    print('분석 모드: ' + (mode if mode in ('mock', 'live') else '미설정 또는 잘못된 값'))
    for name in REQUIRED:
        print(name + ': ' + ('입력됨' if configured(settings[name]) else '미입력 또는 예시 값'))
    example_path = ENV_PATH.with_name('.env.example')
    example = dotenv_values(example_path, encoding='utf-8-sig') if example_path.exists() else {}
    if any(configured(example.get(name)) for name in ('GEMINI_API_KEY', 'TAVILY_API_KEY')):
        print('주의: backend/.env.example에 실제 키로 보이는 값이 있습니다. 프로그램은 backend/.env를 읽습니다. 키를 실제 설정 파일로 옮기고 예시 파일에서는 지우세요.')
    if args.list_models:
        if not configured(settings['GEMINI_API_KEY']):
            print('먼저 backend/.env에 Gemini 키를 입력하고 저장하세요. 키 값은 출력하지 않습니다.')
            return 2
        load_dotenv(ENV_PATH, override=False)
        return asyncio.run(list_models())
    needed = REQUIRED if args.provider == 'both' else ('GEMINI_API_KEY', 'LLM_MODEL') if args.provider == 'gemini' else ('TAVILY_API_KEY',)
    if any(not configured(settings[name]) for name in needed):
        print('backend/.env에 키 2개와 모델 ID를 입력하고 저장하세요. 외부 API는 호출하지 않았습니다.')
        return 2
    if not args.live:
        print('설정 값의 존재만 확인했습니다. 실제 연결 확인은 --live를 붙여 실행하세요.')
        return 0
    if mode != 'live':
        print('ANALYSIS_MODE를 live로 바꾼 뒤 실행하세요. 외부 API는 호출하지 않았습니다.')
        return 2
    load_dotenv(ENV_PATH, override=False)
    calls = 'Gemini 1회 + Tavily 1회' if args.provider == 'both' else args.provider + ' 1회'
    print('실제 API 호출: ' + calls + '. 계정 사용량/크레딧이 소비됩니다.')
    return asyncio.run(check_live(provider=args.provider))


if __name__ == '__main__':
    raise SystemExit(main())
