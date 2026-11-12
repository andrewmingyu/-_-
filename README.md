# NewsCheck AI — 기사 근거와 원출처 추적
뉴스를 읽는 자리에서 기사 핵심 내용, 기사에 제시된 근거와 원출처, 확인 가능한 출처 속성과 주의사항을 보여주는 Chrome MV3 확장입니다.

자극적인 제목과 불명확한 인용이 많은 환경에서 독자가 직접 원자료를 찾는 시간과 피로를 줄이는 것이 목적입니다.
AI는 뉴스의 사실·거짓, 주장-근거의 논리 타당성을 대신 판정하지 않으며 신뢰도 점수나 확률을 생성하지 않습니다.
원본 자료 확인이나 주의사항 부재도 주장의 진실성을 입증하지 않습니다.

## 개발 기준 버전과 현재 상태
확장 manifest 0.2.0 / 기존 경로·schema_version=source-tracing-v1을 유지하고 추가 필드의 data_version=source-tracing-v1.3을 사용합니다.
현재는 **mock 시연 및 자동 검증을 마친 개발 기준점**입니다. 실제 Gemini·Tavily 품질과 Chrome 설치 상태의 네이버 통합은 추가 검증이 필요합니다.
이 문서는 현재 로컬 feature/report-comparison 소스 기준입니다. 원격 main에는 이전 기준 버전의 되돌리기가 적용되어 있어 같은 코드라고 가정하면 안 됩니다. PR #2의 원격 기능 브랜치는 feature/core-flow-integration이고, 이후 보도 비교·화면 배치 보완은 아직 로컬 변경입니다.
기존 HTML/CSS/JavaScript 구조와 기사 추출·원문 위치 이동·아이콘을 보존했습니다. React 전면 재작성이나 담당자 배정은 하지 않았습니다.

## 주요 기능
- 기사 제목 Hover 500ms 후 본문 기반 요약·근거·출처·표현 차이·주의사항 팝업.
- 우측 6개 카드: 배경 및 맥락 / 기사 기본 정보 / 기사의 주장 / 내용의 근거 / 주의할 것 / 비슷한 주제의 기사.
- 각 카드의 독립적인 자세히 보기·접기 및 키보드 조작.
- 요약 1~2문장을 글머리표로 표시하고 작은 기사 정보를 오른쪽에 배치합니다. 배경은 네모·화살표, 관련 기사는 최대 5건의 한 줄 목록으로 보여줍니다.
- 관련 보도의 공통 항목·표현/강조 차이를 현재 기사와 비교 보도의 실제 구절로 나란히 표시. 확보한 본문 발췌·검색 요약·제목만 비교한 경우를 구분하며 사실 판정은 하지 않습니다.
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
    data/                 # demo.json=가상 UI 예시, press.json=언론사 이름 매핑
    icons/                # 기존 확장 아이콘
  backend/
    app/
      main.py             # FastAPI 진입점·요청/응답 경로
      models.py           # Pydantic 데이터 계약
      service.py          # 분석 순서·출처 검사·주의사항·캐시
      clients.py          # 실제 Gemini·Tavily API 어댑터
      prompts.py          # 추출·출처 정리·보도 비교 지시문
      mock.py             # 네트워크 없는 시연용 공급자
      report_comparison.py # 보도 비교의 ID·양쪽 인용 검사
      errors.py           # 공급자 오류 분류
    tests/                # Python API·출처·캐시·비교 회귀
    .env.example          # 비밀 값 없는 서버 설정 예시
    requirements*.txt     # Python 패키지 범위/고정 버전
  fixtures/               # 연결 테스트용 가상 기사 HTML·자료
  docs/                   # 요구사항·구조·API·AI·UI·현황·TODO
  scripts/                # 빌드·검증·스키마 내보내기
  tests/                  # JS·TS 계약/UI 검사
  .github/workflows/ci.yml
```

기존/추가/보존용 파일별 역할과 처음 코드 대비 구성은 [ARCHITECTURE](docs/ARCHITECTURE.md)에 정리했습니다. node_modules/·.venv/는 설치 의존성, dist/는 빌드 결과, .tools/는 임시 검사 자료이며 소스와 함께 커밋하지 않습니다.

## 설치 (Windows PowerShell)
Node.js 24, Python 3.12, Git, Chrome을 준비합니다. 아래 명령은 저장소 루트에서 실행합니다.
```powershell
git clone --branch feature/core-flow-integration https://github.com/andrewmingyu/-_-.git newscheck-ai
cd newscheck-ai
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm.cmd run build
```
이미 저장소가 있다면 다시 clone하지 않고 해당 폴더에서 실행합니다. 위 clone은 원격 PR #2 브랜치를 복제하며 미커밋 로컬 보도 비교·화면 보완은 포함하지 않습니다.
requirements.lock.txt는 검증한 Python 패키지의 정확한 버전 목록입니다. Python 인터프리터 버전은 3.12를 사용합니다. 의존성을 변경할 때 requirements.txt 범위와 함께 검토합니다.
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

## 실제 API를 처음 연결할 때
1. [Google AI Studio API 키](https://aistudio.google.com/apikey)에서 로그인하고 키를 생성/확인합니다. [공식 안내](https://aistudio.google.com/docs/api-key)를 따릅니다.
2. [Tavily 대시보드](https://app.tavily.com/)에서 계정을 만들고 API 키를 확인합니다. [공식 시작 안내](https://docs.tavily.com/)를 참고합니다.
3. backend/.env에 키 두 개를 입력합니다. 키를 채팅·스크린샷·터미널 명령 인수로 보내지 않습니다. GEMINI_API_KEY만 입력한 상태에서도 아래 모델 목록 명령은 사용할 수 있습니다.
```powershell
.\.venv\Scripts\python.exe scripts/check_api_setup.py --list-models
```
4. 출력된 목록에서 사용할 텍스트 생성 모델의 API ID를 골라 LLM_MODEL에 넣습니다. UI의 표시 이름과 API ID는 다를 수 있습니다. 목록에 있다고 구조화 출력까지 검증된 것은 아닙니다.
5. backend/.env의 ANALYSIS_MODE를 live로 바꾸고 저장합니다. 이전 터미널에서 mock를 강제했다면 아래 값도 바꿉니다.
```powershell
$env:ANALYSIS_MODE = 'live'
.\.venv\Scripts\python.exe scripts/check_api_setup.py
```
기본 실행은 설정 값의 존재만 확인하고 외부 API를 호출하지 않습니다. 미입력/예시 값이면 종료 코드 2를 반환하며 이는 설정 미완료 안내입니다. 키나 모델 값은 출력하지 않습니다.
6. 준비가 끝나면 실제 연결을 검사합니다. 이 명령은 Gemini 간단한 구조화 생성 1회와 Tavily 검색 1회를 호출하므로 계정 사용량/크레딧을 소비합니다.
```powershell
.\.venv\Scripts\python.exe scripts/check_api_setup.py --live
```
Gemini와 Tavily 각각 [PASS]가 나와야 합니다. 이는 기본 인증·모델 요청·간단한 JSON 응답·검색 연결 검사이며, 기사 전체의 복잡한 스키마나 분석 정확도까지 보증하지 않습니다. 실패 시 예외 원문/키 대신 공급자별 안전한 오류 코드를 표시합니다.
이미 한 공급자가 통과했다면 중복 호출 없이 다른 쪽만 검사할 수 있습니다. 진행 중인 공급자는 [진행]으로 표시합니다.
```powershell
.\.venv\Scripts\python.exe scripts/check_api_setup.py --live --provider gemini
# 또는 --provider tavily
```
7. 서버를 실행하고 /health의 mode=live를 확인한 뒤 Chrome 확장을 새로고침합니다. 네이버 기사 1건에서 다시 분석을 눌러 실제 데이터와 출처를 확인합니다. 고정 시연용 예시 보기는 실제 API 테스트가 아닙니다.

키가 없는 상태에서는 실제 연결 성공을 보고하지 않습니다. 모델 목록 조회 성공, --live의 간단한 연결 검사, 실제 기사 분석 품질 검증은 서로 다른 단계입니다. 실제 수행 범위는 docs/VALIDATION.md를 따릅니다.

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
- 관련 보도는 확보한 본문 발췌·검색 요약·제목 범위에서 비교합니다. 각 비교에는 양쪽의 실제 인용이 필요하며, 기사 전문 전체를 비교하거나 보도의 독립성을 확인한 것으로 표시하지 않습니다.
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
