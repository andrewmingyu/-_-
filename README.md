# NewsCheck AI — 기사 근거와 원출처 추적
뉴스를 읽는 자리에서 기사 핵심 내용, 기사에 제시된 근거와 원출처, 확인 가능한 출처 속성과 주의사항을 보여주는 Chrome MV3 확장입니다.

자극적인 제목과 불명확한 인용이 많은 환경에서 독자가 직접 원자료를 찾는 시간과 피로를 줄이는 것이 목적입니다.
AI는 뉴스의 사실·거짓, 주장-근거의 논리 타당성을 대신 판정하지 않습니다. 원본 자료 확인이나 주의사항 부재도 주장의 진실성을 입증하지 않습니다.
다만 이 버전은 서버가 찾은 출처·보도 비교·날짜·제목 일치를 **규칙으로 계산한 참고용 신뢰 지수**(🟢/🟡/🔴)를 기사 제목 옆과 패널에 함께 보여줍니다. 이 지수는 사실 여부 판정이 아니며, 자세한 계산과 한계는 [종합 신뢰 지수](#종합-신뢰-지수-참고용)에 있습니다.

> **팀 확인 필요:** 신뢰 지수와 색상 표시는 AGENTS.md의 기존 규칙(신뢰도 점수·확률 생성 금지, 사실/거짓 색상 표시 금지, 보도 비교의 신뢰·독립성 판단 금지)과 충돌합니다. 팀이 규칙을 갱신하기로 합의한 뒤 PR로 병합하세요.

## 개발 기준 버전과 현재 상태
확장 manifest 0.2.0 / 기존 경로·schema_version=source-tracing-v1을 유지하고 추가 필드의 data_version=source-tracing-v1.7을 사용합니다.
현재는 **mock 시연 및 자동 검증을 마친 개발 기준점**입니다. 실제 Gemini·Tavily 품질과 Chrome 설치 상태의 네이버 통합은 추가 검증이 필요합니다.
현재 작업은 팝업 수정 커밋 820ce27을 기반으로 한 로컬 feat/title-meaning-context 소스입니다. 제목 설명·맥락 보완은 아직 커밋·Push하지 않았으며 원격 main과 구분합니다.
기존 HTML/CSS/JavaScript 구조와 기사 추출·원문 위치 이동·아이콘을 보존했습니다. React 전면 재작성이나 담당자 배정은 하지 않았습니다.

## 주요 기능
- 기사 제목 바로 아래 의미 1~2문장·이유 목록을 표시하고, 더보기에서 이유별 근거 카드나 근거 확인 현황으로 이동합니다.
- 맥락은 날짜와 짧은 명사형 표현을 분리하고 주요 사건 하나의 테두리를 굵게 표시합니다. 말줄임으로 원문을 자르지 않으며 원문은 상세에서 확인합니다.
- 네이버 뉴스·연합뉴스TV 기사 링크에 Hover 250ms 후 본문 기반 핵심 요약·제목 표현 차이의 간결한 팝업. 외부 검색을 기다리지 않는다.
- 우측 6개 카드: 배경 및 맥락 / 기사 기본 정보 / 기사의 주장 / 내용의 근거 / 주의할 것 / 비슷한 주제의 기사.
- 각 카드의 독립적인 자세히 보기·접기 및 키보드 조작.
- 요약 1~2문장을 글머리표로 표시하고 작은 기사 정보를 오른쪽에 배치합니다. 배경은 네모·화살표, 관련 기사는 최대 5건의 한 줄 목록으로 보여줍니다.
- 관련 보도의 공통 항목·표현/강조 차이를 현재 기사와 비교 보도의 실제 구절로 나란히 표시. 확보한 본문 발췌·검색 요약·제목만 비교한 경우를 구분하며 사실 판정은 하지 않습니다.
- 문장 선택 후 사용자 클릭으로 문장 유형·관련 출처·원출처 상태·주의사항 표시.
- 드래그 팝업은 분석 중·결과 표시 중 마우스를 옮겨도 유지하고, 팝업 밖 클릭·닫기·Escape로 닫습니다. Hover 팝업은 기존처럼 마우스 이탈 시 닫힙니다.
- 원출처 상태: original_found / secondary_only / source_not_found / unknown.
- 주의사항 상태: caution / none_identified / unknown, 객관적인 이유 및 미확인 정보 함께 저장.
- 실제 검색 URL·ID·정확한 원문 인용 검사, 검색 실패와 빈 결과 구분.
- URL·본문 해시 기반 메모리 캐시와 진행 중 요청 공유.
- 기사 내부 링크·인용·위치 및 확인 가능한 사건 정보 전달, 카드별 분석/오류/데이터 부족 상태.
- 키 없이 입력 기사에 따라 동일 파이프라인을 실행하는 Mock 모드와 별도의 정적 ?demo UI 시연.
- **종합 신뢰 지수(참고용):** 교차검증·출처 확인·추가 검증 필요 주장·제목 일치·날짜 5개 항목을 규칙으로 계산해 🟢 신뢰 높음 / 🟡 주의 필요 / 🔴 주의 요망 / ⚪ 판단 보류로 표시합니다. 항목별 점수와 근거를 함께 보여줍니다.
- **기사 제목 옆 자동 배지:** 뉴스 기사로 판단되면 패널을 열지 않아도 제목 옆에 "분석 중…"이 먼저 뜨고, 분석이 끝나면 신뢰 지수로 바뀝니다. 실패하면 "분석 실패"로 바뀝니다.
- **탭 전환 시 결과 유지:** 패널은 기사별 분석 결과를 30분 동안 기억해, 다른 탭에 갔다 돌아와도 다시 분석하지 않습니다. "다시 분석"은 항상 새로 분석합니다.
- **공식 사이트 우선 검색:** 원출처 검색 뒤에 정부·통계·공시·법령 사이트(`korea.kr`, `kosis.kr`, `dart.fss.or.kr`, `law.go.kr`, `go.kr`)와 유튜브·네이버 안에서 한 번 더 검색합니다.
- **DART 공시 직접 조회:** 기사에 나온 상장사의 최근 180일 공시를 금융감독원 OpenDART에서 가져와 출처 후보에 추가합니다(`DART_API_KEY` 필요, 없으면 건너뜀).
- **Gemini 자동 모델 전환:** 한도 초과(429)·일시 장애(503)·시간 초과(504)·모델 미지원(404) 등이면 다음 모델로 자동 전환합니다.
- 원출처 검색어를 병렬로 실행하고, 포털의 검색 결과 링크는 출처 후보로 쓰지 않습니다. 검색 실행 내역은 서버 터미널에 로그로 남습니다.

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
    shared/               # 계약·API·공통 화면 (summary.js=신뢰 지수·배지 문구 계산)
    sidepanel/            # 6개 카드 패널
    options/              # 서버 설정
    data/                 # demo.json=가상 UI 예시, press.json=언론사 이름 매핑
    icons/                # 기존 확장 아이콘
  backend/
    app/
      main.py             # FastAPI 진입점·요청/응답 경로
      models.py           # Pydantic 데이터 계약
      service.py          # 분석 순서·출처 검사·주의사항·캐시
      clients.py          # 실제 Gemini·Tavily API 어댑터(모델 자동 전환·검색 깊이·지정 사이트 검색)
      official.py         # 공식 자료 조회(금융감독원 DART 공시)
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
Hover에 `Extension context invalidated` 또는 갱신 안내가 보이면 `chrome://extensions`에서 확장 새로고침 후 기사 탭도 **F5**로 새로고침하세요. 확장만 재로드하면 이전 기사 탭의 스크립트 연결은 복구되지 않습니다. 이 경우 API 키 변경이나 서버 재시작은 필요하지 않습니다.

### 확장 권한과 자동 표시
- 자동 표시는 확장 옵션의 "기사를 열면 자동으로 분석하고 제목 옆에 표시"(기본 켜짐)로 끌 수 있습니다.
- 어느 사이트에서든 뉴스 기사로 판단되면 자동으로 동작하도록 모든 `https` 사이트 접근 권한을 요청합니다. 기사 판단은 페이지의 `og:type=article`, `article:published_time`, JSON-LD의 NewsArticle 표지로 하며, 기사로 확인된 페이지만 서버로 보냅니다. 네이버는 표지가 없어도 본문 추출 방식으로 처리합니다.
- 기사 본문이 설정된 서버와 Gemini·Tavily로 전송됩니다. 자동 표시를 켜면 기사를 열 때마다 호출이 늘어 API 한도와 비용이 빨리 소진될 수 있습니다.
- 모든 사이트 접근 권한은 Chrome 웹스토어 심사에서 불리할 수 있습니다. 배포 전에 팀에서 범위를 정하세요.
- 권한(manifest)을 바꾼 뒤에는 `chrome://extensions`에서 확장을 새로고침하고 기사 페이지도 새로고침합니다.

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
LLM_FALLBACK_MODELS=
TAVILY_API_KEY=발급받은_키
TAVILY_SEARCH_DEPTH=
SEARCH_EXTRA_DOMAINS=
DART_API_KEY=
CACHE_TTL_SECONDS=900
```
선택 항목은 비워 두면 기본값을 씁니다. 자세한 의미는 아래 [환경 변수](#환경-변수) 표를 보세요.
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

## 환경 변수
키가 필요한 값은 `backend/.env`에만 넣고 Git·PR·로그·스크린샷에 올리지 않습니다. 값을 바꾼 뒤에는 서버를 재시작합니다.

| 이름 | 기본값 | 설명 |
|---|---|---|
| `ANALYSIS_MODE` | `mock` | `mock` 또는 `live` |
| `GEMINI_API_KEY` / `LLM_MODEL` | 없음 | Gemini 키와 기본 모델 ID |
| `LLM_FALLBACK_MODELS` | 내장 목록 | 기본 모델이 실패할 때 순서대로 쓸 모델 ID(쉼표 구분). `off`면 전환하지 않음 |
| `LLM_MAX_ATTEMPTS` | `3` | 한 요청에서 시도할 최대 모델 수(1~6). 한 번에 최대 45초, 전체 90초 |
| `TAVILY_API_KEY` | 없음 | Tavily 검색 키 |
| `TAVILY_SEARCH_DEPTH` | `advanced` | `basic`으로 낮추면 빠르고 크레딧을 아낌. 관련 기사 검색은 항상 basic |
| `SEARCH_EXTRA_DOMAINS` | `korea.kr,kosis.kr,dart.fss.or.kr,law.go.kr,go.kr,youtube.com,naver.com` | 원출처 검색 뒤 한 번 더 검색할 사이트(쉼표 구분). `off`면 끔 |
| `SEARCH_LOG` | 켜짐 | `off`면 터미널 검색 로그를 끔. 로그에는 검색어 앞 40자와 결과 도메인만 남음 |
| `DART_API_KEY` | 없음 | [OpenDART](https://opendart.fss.or.kr/)에서 무료 발급. 없으면 DART 조회를 건너뜀 |
| `CACHE_TTL_SECONDS` | `900` | 서버 메모리 캐시 유지 시간 |

### Gemini 자동 모델 전환
- `LLM_MODEL`을 먼저 쓰고, 429·503·504·404·400·응답 형식 오류면 `LLM_FALLBACK_MODELS`의 다음 모델로 넘어갑니다. 인증(401)·권한(403)·결제(402) 오류는 어느 모델이든 같으므로 바로 알립니다.
- 실패한 모델은 잠시 건너뜁니다(한도 초과 60초, 일시 장애·시간 초과 30초, 모델 미지원 1시간). 모든 모델이 실패하면 404보다 한도·장애 같은 실제 원인을 알립니다.
- 터미널에는 모델 ID와 오류 코드만 남습니다. 키·기사 내용·공급자 원문은 남기지 않습니다.
- 기본 목록의 모델 이름은 계정에 없을 수 있습니다. `scripts/check_api_setup.py --list-models`로 확인한 모델을 `LLM_FALLBACK_MODELS`에 직접 적는 것을 권장합니다.

### 검색과 공식 자료
1. 기사의 근거 언급(출처명·문서 제목·인용 앞부분)과 기사에 걸린 링크로 검색어를 최대 3개 만들어 병렬로 일반 검색합니다. 포털의 검색 결과 링크는 제외합니다.
2. 같은 검색어를 `SEARCH_EXTRA_DOMAINS`의 사이트 안에서 한 번 더 검색합니다.
3. 기사에 이름이 나온 상장사(제목, 또는 본문 2회 이상)가 있으면 DART 공시 목록을 직접 조회합니다. 공시 메타데이터(보고서명·접수일·제출인)만 쓰며 공시 본문은 읽지 않습니다. 회사명이 일반 단어와 같으면 엉뚱한 공시가 붙을 수 있어 로그의 회사명을 확인하세요.
4. 본문이 없는 후보는 최대 3건까지 원문 추출을 요청하고, 못 얻은 후보는 "검색 요약만 있음"으로 구분합니다.
5. 기사가 지정한 자료와 연결되는 후보만 출처로 인정합니다(링크 일치, 문서 제목 일치, 출처명과 인용문 일치). 주제가 비슷한 것만으로는 연결하지 않습니다.

## 종합 신뢰 지수 (참고용)
서버가 돌려준 분석 결과에서 5개 항목을 규칙으로 점수화해 가중 평균을 냅니다. AI가 기사의 진위를 판단한 값이 아닙니다. 계산 코드는 `newscheck 4/shared/summary.js`의 `credibility()`입니다.

| 항목 | 비중 | 계산 |
|---|---|---|
| 교차검증 | 30 | 비교한 다른 보도 수와 공통점·차이점 비율 |
| 출처 확인 | 30 | 주장별 원본 확인 여부, 작성자·언론사 표기, 익명 인용 감점 |
| 추가 검증 필요 주장 | 15 | 주의·정보 부족으로 남은 주장의 비율 |
| 제목·본문 일치 | 15 | 제목 표현이 본문 요약·주장에 담긴 정도 |
| 날짜 | 10 | 기사 작성일과 오늘의 차이(2일 이내 100, 30일 이내 80, 1년 이내 50, 그 이상 25) |

- 기준: 70% 이상 🟢 신뢰 높음, 40~69% 🟡 주의 필요, 40% 미만 🔴 주의 요망. 비중과 기준선은 초기값이며 실제 기사로 조정해야 합니다(`WEIGHTS`, `CRED_THRESHOLDS`).
- 추적한 주장이 없거나 계산할 수 있는 정보가 절반 미만이면 점수를 내지 않고 ⚪ 판단 보류로 표시합니다. 계산하지 못한 항목은 제외하고 화면에 이유를 적습니다.
- 사진 자료의 날짜는 웹페이지에서 읽을 수 없어 반영하지 않습니다. AI가 만든 제목과의 비교도 구현하지 않았고 본문 요약과의 겹침으로 대신합니다.
- 연예·인터뷰처럼 출처를 내세우지 않는 기사는 점수가 낮게 나올 수 있습니다. 점수는 기사의 사실 여부와 무관합니다. 화면에 "참고용 추정 점수이며 사실 판정이 아니다"라는 안내를 항상 함께 표시합니다.

## 테스트
Hover·드래그 스크립트는 네이버 뉴스(news.naver.com, n.news.naver.com)와 연합뉴스TV(yonhapnewstv.co.kr, www.yonhapnewstv.co.kr)에 주입합니다. Hover 대상은 네이버 /article/·/mnews/article/ 및 연합뉴스TV /news/MYH… 기사 링크입니다. 링크가 아닌 현재 기사 제목은 Hover 대상이 아닙니다. 패널·자동 배지의 전체 HTTPS 권한과 팝업 지원 도메인은 서로 다릅니다.
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
`npm test`는 콘텐츠 스크립트가 동적으로 읽는 모듈의 간접 의존성까지 `web_accessible_resources`에 선언됐는지 검사합니다. 실제 MV3 패키지 로딩과 Hover·선택 팝업 회귀는 다음 별도 검사로 확인할 수 있습니다. 이 검사는 임시 프로필과 가상 네이버 기사·로컬 HTTP 응답을 사용하며 실제 뉴스·AI API를 호출하지 않습니다.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tools\pw-browsers'
node node_modules/playwright-core/cli.js install chromium --no-shell
npm.cmd run build
npm.cmd run test:extension
$env:TEST_ARTICLE_URL = 'https://www.yonhapnewstv.co.kr/news/MYH20261113165748OZp'
npm.cmd run test:extension
Remove-Item Env:TEST_ARTICLE_URL
```

테스트용 Chromium은 위 설치를 처음 실행할 때 다운로드합니다. 사용자 Chrome 프로필은 사용하지 않습니다. 기존 `test:browser`·`test:integration`과 달리 실제 확장 권한·리소스 로딩을 적용하지만, 운영 네이버나 실제 API 품질 검증은 별도로 필요합니다.
자동 검사가 실제 모델 품질·Chrome 설치 상태 검증을 대신하지 않습니다. 상세 증거와 남은 검사는 [VALIDATION](docs/VALIDATION.md)에 있습니다.

## 현재 제약과 다음 작업
- 실제 Gemini·Tavily 호출, 설치된 MV3 권한·서비스 워커·실제 네이버 DOM은 추가 검증이 필요합니다.
- 본문 12,000자 제한은 body_truncated와 주의사항으로 표시합니다. JSON-LD Event/기사 원문의 날짜·장소를 확인한 경우에만 반영합니다. 기사 밖 배경·기자 약력의 독립 수집은 미구현입니다.
- 관련 보도는 확보한 본문 발췌·검색 요약·제목 범위에서 비교합니다. 각 비교에는 양쪽의 실제 인용이 필요하며, 기사 전문 전체를 비교하거나 보도의 독립성을 확인한 것으로 표시하지 않습니다.
- 출처 속성은 원문에서 관찰한 문구입니다. 전문자격·이해관계 부재·원본 관계를 독립적으로 보증하지 않습니다.
- Hover는 redirect·차단·유료 페이지에서 실패할 수 있습니다. 제목으로 대체 요약하지 않습니다.
- 캐시는 메모리 기본 15분/최대 128건이며 서버 재시작 시 사라집니다.
- 429/503/504/502와 단계별 오류·Retry-After는 구분합니다. Gemini는 모델 자동 전환이 있지만 같은 프로젝트의 한도를 공유하면 모든 모델이 막힐 수 있습니다. 요청/비용 제한, 공개 서버 인증·지속 캐시는 아직 없습니다.
- 출처 검색은 Tavily 웹 검색과 DART 공시 목록에 의존합니다. KOSIS·국가법령정보센터 등 다른 공식 API는 직접 조회하지 않으며, DART도 공시 본문 대조는 하지 않습니다.
- 서버는 일부 단계가 실패한 결과를 캐시하지 않아, 자동 배지와 패널이 같은 기사를 각각 분석할 수 있습니다. 패널의 결과 기억(30분)은 패널이 열려 있는 동안만 유지됩니다.
- 신뢰 지수의 가중치와 기준선, 제목·본문 일치 계산은 검증되지 않은 초기 규칙입니다. 공개·시연 전에 팀에서 표현 수위와 기준을 검토하세요.
- 확장은 모든 `https` 사이트 접근 권한을 사용합니다. 기사 판별은 페이지의 표지에 의존해 표지가 없는 사이트는 자동 표시되지 않을 수 있습니다.
- GET /api/articles/{article_id}?url=...로 만료 전 결과를 조회합니다. Hover의 30초/64건 워커 인덱스와 서버 본문 해시 검사로 수집 전 캐시를 확인하고, 없으면 본문을 수집합니다.
- 세부 상태 25건은 [PROJECT_SPEC](docs/PROJECT_SPEC.md), 다음 개발의 완료 조건은 [TODO](docs/TODO.md)를 따릅니다.

## 개발 문서
[요구사항·기능 현황](docs/PROJECT_SPEC.md) · [구조](docs/ARCHITECTURE.md) · [API](docs/API_SPEC.md) ·
[AI 흐름](docs/AI_PIPELINE.md) · [UI](docs/UI_SPEC.md) · [검증](docs/VALIDATION.md) ·
[변경 내역](docs/MIGRATION.md) · [TODO](docs/TODO.md) · [협업 절차](CONTRIBUTING.md) · [에이전트 규칙](AGENTS.md).

개발은 기능 브랜치 → 검사 → PR → 보호 규칙/필수 리뷰 충족 → Merge로 진행합니다. 기본 브랜치 직접 Push나 Force Push는 하지 않습니다.
