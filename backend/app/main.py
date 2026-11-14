import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .clients import Gemini, Tavily
from .models import AnalyzeRequest, ArticleAnalysis, Preview, SelectionRequest, SelectionAnalysis, WordRequest, WordAnalysis
from .service import Analyzer, ArticleInputError
from .errors import ProviderError
from .official import Dart
from .videos import YouTubeOEmbed
from .words import WordExplainer

app = FastAPI(title='뉴스체크 AI — 출처 추적', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origin_regex=r'chrome-extension://[a-p]{32}',
    allow_methods=['POST', 'GET'], allow_headers=['Content-Type'])
analyzer = Analyzer(Gemini(), Tavily(), mode=os.getenv('ANALYSIS_MODE', 'mock'),
    ttl=int(os.getenv('CACHE_TTL_SECONDS', '900')), official=Dart(), video=YouTubeOEmbed())
if analyzer.mode not in ('mock', 'live'):
    raise RuntimeError('ANALYSIS_MODE는 mock 또는 live여야 합니다.')


@app.exception_handler(ProviderError)
async def provider_error(request, exc):
    headers = {'Retry-After':str(exc.retry_after_seconds)} if exc.retry_after_seconds is not None else None
    return JSONResponse(status_code=exc.http_status,headers=headers,content={
        'detail':exc.message,'error':{'code':exc.code,'provider':exc.provider,'retry_after_seconds':exc.retry_after_seconds}})


async def run_analysis(request,preview=False):
    try:
        return await (analyzer.preview(request) if preview else analyzer.analyze(request))
    except ArticleInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ProviderError:
        raise
    except Exception as exc:
        # Never return provider exception text: it may contain request URLs or credentials.
        raise HTTPException(502, '기사 분석에 실패했습니다. 서버 설정과 연결을 확인해 주세요.') from exc


@app.get('/health')
def health():
    return {'status': 'ok', 'mode': analyzer.mode, 'schema_version': 'source-tracing-v1','data_version':'source-tracing-v1.10'}


@app.post('/api/articles/analyze', response_model=ArticleAnalysis)
async def analyze(request: AnalyzeRequest):
    return await run_analysis(request)


@app.get('/api/articles/{article_id}', response_model=ArticleAnalysis)
def existing_analysis(article_id: str, url: str | None = None):
    try:
        result = analyzer.lookup(article_id,url)
    except ValueError as exc:
        raise HTTPException(422,'기사 URL 형식이 올바르지 않습니다.') from exc
    if result is None:
        raise HTTPException(404,'캐시된 분석이 없거나 만료되었습니다.')
    return result


@app.post('/api/preview', response_model=Preview)
async def preview(request: AnalyzeRequest):
    return await run_analysis(request,preview=True)


@app.post('/api/claims/check', response_model=SelectionAnalysis)
async def selection(request: SelectionRequest):
    try:
        return await analyzer.selection(request)
    except ArticleInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ProviderError:
        raise
    except Exception as exc:
        raise HTTPException(502, '선택 문장 출처 분석에 실패했습니다.') from exc


@app.post('/api/words/explain',response_model=WordAnalysis)
async def word(request:WordRequest):
    try:
        if not hasattr(analyzer,'words'):
            analyzer.words=WordExplainer(analyzer.llm,analyzer.search,mode=analyzer.mode,ttl=analyzer.ttl)
        return await analyzer.words.explain(request)
    except ArticleInputError as exc:
        raise HTTPException(422,str(exc)) from exc
    except ProviderError:
        raise
    except Exception as exc:
        raise HTTPException(502,'단어 설명을 완료하지 못했습니다. 서버 설정과 연결을 확인해 주세요.') from exc
