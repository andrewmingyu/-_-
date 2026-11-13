# 기본 기능 및 통합 검증 결과
## 2026-11-13 팝업 회귀 수정 검증
추가 검증: 선택 응답을 의도적으로 보류하고 마우스를 팝업 밖·기사 링크 위로 이동시켜도 선택 분석 화면이 유지됨을 확인한다. 결과 화면의 내부 클릭·마우스 이탈은 유지, 바깥 클릭은 닫기이며, 대기 중 닫힌 팝업을 늦은 응답이 다시 열지 않는다. Hover 결과의 마우스 이탈 닫기는 유지한다. 수정 전에는 이동 후 350ms 안에 선택 팝업이 사라지는 실패를 재현했다. 해당 검사는 test:browser와 실제 MV3 test:extension에 포함한다.
- 기준: PR #5 및 다크모드 수정 f404edf에서 분기한 로컬 fix/hover-selection-popups. 제품의 API·출처 분석·점수 로직은 변경하지 않았다.
- 수정 전 실제 MV3 확장에서 summary.js의 웹 접근 거부와 view.js 동적 import 실패를 재현했다. 또한 Hover 이탈 후 새 문장 선택 팝업이 180ms 닫기 타이머 때문에 사라지는 것을 재현했다.
- 수정: manifest에 간접 모듈 summary.js 등록, hide()에서 기존 닫기 타이머 해제. 기존 도메인 지원 범위와 권한은 유지한다.

| 검사 | 결과 | 범위 |
|---|---|---|
| npm test | 31개 통과 | 기존 회귀·간접 모듈 선언·중복 선택 권한 거부 및 네이버/연합뉴스TV 기사 URL 허용·오인/로컬 주소 거부 |
| Python pytest | 82개 통과 | 모델 전환·공식 자료·검색 도메인을 포함한 서버 회귀. 사용 중단 예정 경고 1개 |
| typecheck / build | 통과 | TypeScript 계약·JavaScript 구문·dist/newscheck 생성 |
| test:browser | 통과 | 기존 320/440/880px 패널·팝업·이벤트 검사 |
| test:integration / HTTP smoke | 통과 | 실제 worker 모듈·로컬 FastAPI Mock·캐시·기존/신규 선택·서버 중단 오류. Chrome API와 운영 사이트는 어댑터 |
| test:extension | 두 도메인 통과 | Chrome for Testing 158의 임시 프로필에 실제 MV3 로드. 네이버·연합뉴스TV 각각 콘텐츠 스크립트·모듈 접근 권한·worker 메시지·warm Hover·선택 버튼/결과·이전 Hover 타이머 회귀 |
| diff --check / check-commit | 통과 | 공백 오류·제외 대상·고확률 비밀 패턴 검사 |

자동 단위·회귀는 JavaScript 31 + Python 82 = **113개**이며 브라우저·HTTP smoke는 별도다. test:extension은 네이버·연합뉴스TV 주소의 가상 페이지와 로컬 fixture HTTP 응답을 사용한다. 사용자 제공 연합뉴스TV HTML은 HTTP 200으로 확보해 기사 판정·2,702자 본문 추출을 별도 확인했다. 사용자 Chrome 프로필·개인 .env는 사용하지 않았고 실제 Gemini/Tavily/DART 요청은 하지 않았다. cold Hover·FastAPI 전체 연결은 기존 어댑터 통합 검사와 구분한다. 운영 사이트의 동적 링크·실제 API 분석 품질은 여전히 별도 확인이 필요하다.

수정 후 .tools/extension-hover.png, .tools/extension-selection.png를 확인했다. dist 빌드 후 사용자가 확장을 재로드하고 기존 뉴스 탭도 새로고침해야 한다. 로컬 수정만 했으며 커밋·Push·PR·Merge는 하지 않았다.

## 아래는 2026-11-12 이전 검증 기록
기준일: 2026-11-12 (Asia/Seoul). 확장 0.2.0, schema_version=source-tracing-v1, data_version=source-tracing-v1.3.
현재 기능 브랜치의 로컬 검증 기록이다. 이전 main 기준 JavaScript 9개·Python 19개와 이번 결과를 구분한다.

## 실행한 검증
| 명령 | 결과 | 검증 범위 |
|---|---|---|
| npm.cmd test | 20개 통과 | 기존 추출·카드·캐시·API 회귀, 보도 비교·안전한 렌더링·독립 토글 및 요약 글머리표·메타데이터 위치·배경 네모/화살표·한 줄 기사 목록 |
| npm.cmd run typecheck | 통과 | Pydantic과 대응하는 TypeScript 계약 및 기존 기본값 호환 |
| npm.cmd run build | 통과 | 확장 JavaScript 구문·manifest 진입점 및 dist/newscheck 패키지 |
| npm.cmd run test:browser | 통과 | Chrome headless 320/440/880px에서 요약 옆 작은 기사 정보, 배경 네모/화살표, 한 줄 보도·기사별 비교 펼침, 독립 카드·키보드·Hover·선택 이벤트 |
| .venv/Scripts/python.exe -m pytest -q | 53개 통과 | 기존 회귀·키 비노출·공급자별 점검·오류 구분 및 관련 기사 5건 중 앞 3건만 비교하는 계약 |
| .venv/Scripts/python.exe scripts/check_api_setup.py | 설정 입력 확인 | 실제 키 2개를 Git 제외 .env로 옮긴 뒤 mode=live·키/모델 입력 확인. 생성·검색 호출 없음 |
| .venv/Scripts/python.exe scripts/check_api_setup.py --list-models | 실제 조회 성공 | Gemini 모델 목록 요청 성공, 생성 지원 모델 40개 표시. 목록 조회와 아래의 실제 생성·검색 검사는 별개 |
| .venv/Scripts/python.exe scripts/check_api_setup.py --live --provider gemini | 실제 PASS | gemini-3.1-flash-lite의 작은 ConnectionReply 구조화 응답 성공. 앞서 gemini-3.8-flash 시험은 504 DEADLINE_EXCEEDED로 실패해 로컬 모델 설정 변경 |
| 사용자가 실행한 --live의 Tavily 결과 | 실제 PASS 보고 | 검색 결과 5건으로 사용자 터미널 출력 확인. Gemini 재검사에서 Tavily 중복 호출은 하지 않음 |
| .venv/Scripts/python.exe scripts/smoke_backend.py | 통과 | 실제 로컬 Uvicorn HTTP의 health·기사·preview·문장 선택, 같은 article_id/body_hash/is_demo 및 출처 |
| npm.cmd run test:integration | 통과 | 기존 A/B/C/D에 공통·차이 구절과 검색 요약 범위 배지, 320px/440px 넘침 없음 및 실제 카드 화면 캡처 추가 |
| node scripts/check-commit.mjs | 통과 | 추적/추가 후보 파일에서 제외 대상 및 고확률 비밀 패턴 검사; 비밀 값은 출력하지 않음 |
| git diff --check | 통과 | 변경 공백 오류 없음 |
| 로컬 문서 링크 검사 | 통과 | README/개발 문서의 상대 링크 대상 존재 |

자동 단위·회귀 테스트는 **JavaScript 20 + Python 53 = 73개**다. Chrome 브라우저·HTTP·A/B/C/D 통합 smoke는 별도 실행한다. API 설정 CLI의 단위 테스트는 대체 클라이언트를 사용하며 별도 실행한 실제 연결 검사와 구분한다. 작은 구조화 응답의 성공은 기사 분석 품질 검증이 아니다.
공급자 SDK 설정과 HTTP 오류는 대체 클라이언트/MockTransport로 확인했으며 실제 공급자 호출 결과가 아니다.

## A/B/C/D 전체 연결 검사
scripts/integration-smoke.mjs는 fixtures/naver_article.html과 mock_source_documents.json의 가상 기사/자료를 사용한다.
서버는 Gemini/Tavily 키를 비우고 ANALYSIS_MODE=mock으로 시작한다. 외부 목적지 요청은 차단하며, 정상 종료 후 소켓 서버도 정리한다.

| 흐름 | 연결 및 확인한 결과 |
|---|---|
| A — 상세 분석 | 네이버 대표 DOM 추출 → worker → FastAPI → 입력 종속 Mock 제공자 → 동일 Analyzer → 기사 정보·사건·6개 카드. 독립 더보기/접기 유지 |
| B — Hover | 짧은 Hover 요청 0건, 따뜻한 캐시의 GET 조회·본문 해시 검사, 차가운 캐시의 HTML 수집·preview 요청. 패널과 같은 기사 ID/본문 해시/분석 버전 |
| C — 문장 선택 | 기존 주장은 부모 결과 재사용, 새 선택은 별도 analysis_id·독립 claim ID로 분석. 부모 기사 ID·전체 기사 캐시 보존, 관련 근거·주의사항 표시 |
| D — 근거와 공신력 | 기사 인용 → 검색 후보 URL → fixture 원문 인용 → 작성자 포함 10개 관찰 → 출처 상태/주의사항 이유·참조 → 공통 UI. 원문 위치와 타임라인 참조 검사 |
| 오류 | 실제 Mock HTTP 서버 종료 → 실패 카드·메타데이터·재시도 표시. 실패를 성공으로 위장하거나 이전 분석 결과를 새 분석으로 표시하지 않음 |

성공 분석 1건은 패널·Hover·기존 선택이 공유한다. 계수의 analyze 2회 중 두 번째는 서버 중단 후 실패/재시도 검사다.
서버 Mock도 고정 분석 응답을 반환하지 않고 실제 입력·해시와 동일 분석 경로를 사용한다. 고정 UI fixture는 별도의 ?demo 화면에만 남긴다.

## 검증 환경과 한계
- 로컬 Windows, Node 24, Python 3.12 가상환경, 설치된 Chrome headless를 사용했다.
- 의존성은 package-lock.json과 backend/requirements.lock.txt에 기록한다.
- pytest의 Starlette TestClient/httpx 사용 중단 예정 경고 1개는 남아 있다. 테스트 실패는 아니다.
- 브라우저 검사는 chrome.runtime/tabs/storage 경계를 어댑터로 연결한다. 설치된 MV3 서비스 워커·권한·수명주기 검증이 아니다.
- 대표 네이버 HTML은 합성 fixture를 replay한다. 현재 운영 네이버 페이지의 실환경 검증이 아니다.
- 출처 내용은 가상 자료이며 is_demo를 표시하고 가상 링크 이동을 막는다. Mock 결과는 AI 정확도나 실제 원출처 확인의 증거가 아니다.
- .github/workflows/ci.yml에 같은 검증을 구성했다. 이 문서는 로컬 검증 기록이며, 해당 커밋의 원격 CI 결과는 PR의 Checks에서 별도로 확인한다.

## 실행하지 않은 검증과 남은 범위
- 실제 기사의 Extraction/SourceReviews/ReportComparisons 전체 구조화 출력 호환성과 추출 품질. 실제 Gemini의 작은 ConnectionReply 생성은 성공했지만 복잡한 기사 스키마까지 검증한 것은 아니다.
- 실제 Tavily 검색/extract의 원문·발행일·원자료 관계·요청 제한·응답시간, 출처 10개 관찰과 주의사항의 정확도.
- 실제 Gemini의 다른 보도 공통/차이 분류 정확도와 동일 사건 후보 선정 품질. 인용 존재 검사만으로 비교 해석의 적절성을 보증하지 않는다.
- Chrome에 확장을 설치한 실제 네이버 기사 2~3건의 추출·Hover·패널·드래그·탭 이동·캐시 갱신.
- 실제 동적 목록·복합/부분 선택·접근성·화면낭독기·키보드 Hover 대체.
- 공개 기자 약력·기사 밖 배경 수집, 기사 전문 비교, 자동 backoff·요청/비용 제한·인증·지속 캐시·단계 스트리밍은 미구현.
이번 패널 배치 변경 검증에서는 외부 API를 추가 호출하지 않았다. 앞서 실행한 실제 연결 검사는 위 표와 구분한다. 다음 검증의 선행 조건·완료 조건·관련 파일은 TODO.md에 명시한다.

## Git 상태
개발 기준 PR #1 커밋은 33b9b0a, PR #2의 핵심 흐름 보완 커밋은 1e4e425다.
이번 보도 비교는 1e4e425 기반의 feature/report-comparison에 로컬 변경으로 유지한다. 2026-11-12 fetch에서 origin/main의 PR #1 되돌리기(b04c628)를 확인했으며 원격 코드는 수정하지 않았다. 이번 변경의 commit/Push/PR/Merge/Issues 생성 및 원격 CI 실행은 하지 않았다.
