# NewsCheck AI — 기사 근거와 원출처 추적
뉴스를 읽는 자리에서 기사 핵심 내용, 기사에 제시된 근거와 원출처, 확인 가능한 출처 속성과 주의사항을 보여주는 Chrome MV3 확장입니다.

자극적인 제목과 불명확한 인용이 많은 환경에서 독자가 직접 원자료를 찾는 시간과 피로를 줄이는 것이 목적입니다.
AI는 뉴스의 사실·거짓, 주장-근거의 논리 타당성을 대신 판정하지 않으며 신뢰도 점수나 확률을 생성하지 않습니다.
원본 자료 확인이나 주의사항 부재도 주장의 진실성을 입증하지 않습니다.

## 개발 기준 버전과 현재 상태
확장 manifest 0.2.0 / 기존 경로·schema_version=source-tracing-v1을 유지하고 추가 필드의 data_version=source-tracing-v1.1을 사용합니다.
현재는 **mock 시연 및 자동 검증을 마친 개발 기준점**입니다. 실제 Gemini·Tavily 품질과 Chrome 설치 상태의 네이버 통합은 추가 검증이 필요합니다.
기존 HTML/CSS/JavaScript 구조와 기사 추출·원문 위치 이동·아이콘을 보존했습니다. React 전면 재작성이나 담당자 배정은 하지 않았습니다.

## 주요 기능
- 기사 제목 Hover 500ms 후 본문 기반 요약·근거·출처·표현 차이·주의사항 팝업.
- 우측 6개 카드: 배경 및 맥락 / 기사 기본 정보 / 기사의 주장 / 내용의 근거 / 주의할 것 / 비슷한 주제의 기사.
- 각 카드의 독립적인 자세히 보기·접기 및 키보드 조작.
- 문장 선택 후 사용자 클릭으로 문장 유형·관련 출처·원출처 상태·주의사항 표시.
- 원출처 상태: original_found / secondary_only / source_not_found / unknown.
- 주의사항 상태: caution / none_identified / unknown, 객관적인 이유 및 미확인 정보 함께 저장.
- 실제 검색 URL·ID·정확한 원문 인용 검사, 검색 실패와 빈 결과 구분.
- URL·본문 해시 기반 메모리 캐시와 진행 중 요청 공유.
- 기사 내부 링크·인용·위치 및 확인 가능한 사건 정보 전달, 카드별 분석/오류/데이터 부족 상태.
- 키 없이 입력 기사에 따라 동일 파이프라인을 실행하는 Mock 모드와 별도의 정적 ?demo UI 시연.

## 기술 스택
| 영역 | 현재 구현 |
|---|---|
| 확장·UI | Chrome Manifest V3, HTML/CSS/JavaScript, Shadow DOM |
| 공통 계약 | TypeScript 타입, Pydantic 모델, JSON Schema |
| 백엔드 | Python 3.12, FastAPI, Uvicorn, httpx |
| AI·검색 | Google GenAI SDK(Gemini), Tavily HTTP API |
| 저장 | 프로세스 메모리 캐시; DB 미사용 |
| 검증 | Node test runner·jsdom·TypeScript, pytest, Playwright Core + 설치된 Chrome |
| CI | GitHub Actions의 mock 테스트·타입·빌드·HTTP·브라우저 검사 |

Readability·React·Fact Check Tools API는 현재 도입하지 않았습니다.

## 프로젝트 구조
```text
newscheck-ai/
  newscheck 4/             # Chrome 확장 소스
    content.js            # Hover·선택
    background.js         # MV3 메시지·서버 요청
    lib/extract.js        # 기사 DOM 추출
    shared/               # 계약·API·공통 화면
    sidepanel/            # 6개 카드 패널
    options/              # 서버 설정
    data/                 # 명확히 표시된 시연 데이터
  backend/app/            # API·Gemini·Tavily·출처·주의사항·캐시
  backend/tests/
  docs/                   # 요구사항·구조·API·AI·UI·현황·TODO
  scripts/                # 빌드·검증·스키마 내보내기
  tests/                  # JS·TS 계약/UI 검사
  .github/workflows/ci.yml
```

## 설치 (Windows PowerShell)
Node.js 24, Python 3.12, Git, Chrome을 준비합니다. 아래 명령은 저장소 루트에서 실행합니다.
```powershell
git clone https://github.com/andrewmingyu/-_-.git newscheck-ai
cd newscheck-ai
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm.cmd run build
```
requirements.lock.txt는 검증한 정확한 Python 버전 목록입니다. 의존성을 변경할 때 requirements.txt 범위와 함께 검토합니다.
가상환경을 활성화하지 않고 해당 python.exe를 직접 사용해도 됩니다.

## Chrome 확장 로드
1. Chrome에서 `chrome://extensions`를 엽니다.
2. 개발자 모드를 켜고 압축해제된 확장 프로그램 로드를 선택합니다.
3. 저장소의 `dist/newscheck` 폴더를 선택합니다. 소스 `newscheck 4`를 직접 로드해도 됩니다.
4. 확장 옵션 → **시연용 예시 보기**에서 서버·API 키 없이 6개 카드를 확인합니다.
5. 실제 네이버 기사에서는 확장 툴바 아이콘으로 패널을 엽니다.

코드 변경 후 다시 build하고 확장을 새로고침합니다. content script를 갱신하려면 기사 페이지도 새로고침합니다.

## FastAPI 서버 실행
```powershell
if (!(Test-Path -LiteralPath backend/.env)) {
    Copy-Item backend/.env.example backend/.env
}
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000
```
기존 .env를 덮어쓰지 않습니다.
- http://127.0.0.1:8000/health : 서버 상태·모드.
- http://127.0.0.1:8000/docs : 현재 API 직접 실행.
- 확장 옵션의 서버 주소 기본값: http://127.0.0.1:8000.

## Mock와 실제 API 모드
backend/.env의 기본값은 `ANALYSIS_MODE=mock`입니다. 입력 본문과 메타데이터를 사용해 실제 Analyzer의 추출→검색→출처 관찰→주의사항→캐시 경로를 규칙·fixture 공급자로 실행합니다. 원문 위치와 기사 해시도 입력에 맞게 산출합니다. 실제 AI·실제 검색 결과는 아니며 is_demo=true를 유지합니다.
fixtures/naver_article.html과 mock_source_documents.json은 서로 연결된 가상 기사·자료입니다. 그 밖의 입력에 이 가상 자료를 임의로 연결하지 않습니다. ?demo 옵션 화면만 기존의 고정 UI 예시를 사용합니다.
화면마다 시연용 예시를 표시하고 가상 URL은 클릭되지 않습니다. 본문 없는 요청은 mock에서도 422입니다.

실제 분석을 검증할 때 서버 환경 파일을 다음과 같이 설정하고 서버를 재시작합니다.
```dotenv
ANALYSIS_MODE=live
GEMINI_API_KEY=발급받은_키
LLM_MODEL=계정에서_사용가능한_모델_ID
TAVILY_API_KEY=발급받은_키
CACHE_TTL_SECONDS=900
```
키·모델·요금·한도는 공급자 계정 및 공식 문서에서 확인합니다.
확장에는 서버 주소만 저장합니다. 기존 브라우저 API 키는 사용하지 않으며 옵션의 별도 버튼으로 삭제할 수 있습니다.
기사 본문·선택 문장은 설정된 서버로 전송되고 live 모드에서는 Gemini·Tavily를 사용합니다. 키나 실제 기사 전문을 Git/PR/로그에 넣지 않습니다.

## 테스트
```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:browser
npm.cmd run test:integration
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/smoke_backend.py
node scripts/check-commit.mjs
git diff --check
```
브라우저 테스트는 기본 `C:/Program Files/Google/Chrome/Application/chrome.exe`를 사용합니다.
다르면 `$env:CHROME_PATH='설치된 Chrome 실행 파일 경로'`를 설정합니다.
HTTP smoke는 임시 로컬 포트의 mock 서버를 띄우며 실제 AI API를 호출하지 않습니다.
통합 검사는 실제 extractArticle·background.js·API 클라이언트·Uvicorn·Mock 파이프라인·카드/팝업을 연결합니다. Chrome API 경계와 네이버 페이지는 테스트 어댑터/합성 DOM이며 설치된 확장이나 실제 네이버 검사를 대신하지 않습니다. Python 경로를 별도로 지정하려면 PYTHON_PATH를 사용합니다.
자동 검사가 실제 모델 품질·Chrome 설치 상태 검증을 대신하지 않습니다. 상세 증거와 남은 검사는 [VALIDATION](docs/VALIDATION.md)에 있습니다.

## 현재 제약과 다음 작업
- 실제 Gemini·Tavily 호출, 설치된 MV3 권한·서비스 워커·실제 네이버 DOM은 추가 검증이 필요합니다.
- 본문 12,000자 제한은 body_truncated와 주의사항으로 표시합니다. JSON-LD Event/기사 원문의 날짜·장소를 확인한 경우에만 반영합니다. 기사 밖 배경·기자 약력의 독립 수집은 미구현입니다.
- 관련 기사는 검색 요약이며 전문 비교·독립성 확인 결과로 표시하지 않습니다.
- 출처 속성은 원문에서 관찰한 문구입니다. 전문자격·이해관계 부재·원본 관계를 독립적으로 보증하지 않습니다.
- Hover는 redirect·차단·유료 페이지에서 실패할 수 있습니다. 제목으로 대체 요약하지 않습니다.
- 캐시는 메모리 기본 15분/최대 128건이며 서버 재시작 시 사라집니다.
- 429/503/504/502와 단계별 오류·Retry-After는 구분하지만 자동 backoff, 요청/비용 제한, 공개 서버 인증·지속 캐시는 아직 없습니다.
- GET /api/articles/{article_id}?url=...로 만료 전 결과를 조회합니다. Hover의 30초/64건 워커 인덱스와 서버 본문 해시 검사로 수집 전 캐시를 확인하고, 없으면 본문을 수집합니다.
- 세부 상태 25건은 [PROJECT_SPEC](docs/PROJECT_SPEC.md), 다음 개발의 완료 조건은 [TODO](docs/TODO.md)를 따릅니다.

## 개발 문서
[요구사항·기능 현황](docs/PROJECT_SPEC.md) · [구조](docs/ARCHITECTURE.md) · [API](docs/API_SPEC.md) ·
[AI 흐름](docs/AI_PIPELINE.md) · [UI](docs/UI_SPEC.md) · [검증](docs/VALIDATION.md) ·
[변경 내역](docs/MIGRATION.md) · [TODO](docs/TODO.md) · [협업 절차](CONTRIBUTING.md) · [에이전트 규칙](AGENTS.md).

개발은 기능 브랜치 → 검사 → PR → 보호 규칙/필수 리뷰 충족 → Merge로 진행합니다. 기본 브랜치 직접 Push나 Force Push는 하지 않습니다.
