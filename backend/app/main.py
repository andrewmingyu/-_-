import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .clients import Gemini, Tavily
from .models import AnalyzeRequest, ArticleAnalysis, Preview, SelectionRequest, SelectionAnalysis
from .service import Analyzer, ArticleInputError

app = FastAPI(title='뉴스체크 AI — 출처 추적', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origin_regex=r'chrome-extension://[a-p]{32}',
    allow_methods=['POST', 'GET'], allow_headers=['Content-Type'])
analyzer = Analyzer(Gemini(), Tavily(), mode=os.getenv('ANALYSIS_MODE', 'mock'),
    ttl=int(os.getenv('CACHE_TTL_SECONDS', '900')))
if analyzer.mode not in ('mock', 'live'):
    raise RuntimeError('ANALYSIS_MODE는 mock 또는 live여야 합니다.')


async def run_analysis(request):
    try:
        return await analyzer.analyze(request)
    except ArticleInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        # Never return provider exception text: it may contain request URLs or credentials.
        raise HTTPException(502, '기사 분석에 실패했습니다. 서버 설정과 연결을 확인해 주세요.') from exc


@app.get('/health')
def health():
    return {'status': 'ok', 'mode': analyzer.mode, 'schema_version': 'source-tracing-v1'}


@app.post('/api/articles/analyze', response_model=ArticleAnalysis)
async def analyze(request: AnalyzeRequest):
    return await run_analysis(request)


@app.post('/api/preview', response_model=Preview)
async def preview(request: AnalyzeRequest):
    a = await run_analysis(request)
    return Preview(article_id=a.article_id, is_demo=a.is_demo, summary=a.one_line_summary,
        major_evidence=a.evidence_mentions[:2], sources=a.sources[:2], headline_difference=a.headline_difference,
        one_line_caution=a.caution.reasons[0], search_status=a.search_status)


@app.post('/api/claims/check', response_model=SelectionAnalysis)
async def selection(request: SelectionRequest):
    try:
        return await analyzer.selection(request)
    except ArticleInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, '선택 문장 출처 분석에 실패했습니다.') from exc
