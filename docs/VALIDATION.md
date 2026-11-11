# 기본 기능 및 통합 검증 결과
기준일: 2026-11-11 (Asia/Seoul). 확장 0.2.0, schema_version=source-tracing-v1, data_version=source-tracing-v1.1.
현재 기능 브랜치의 로컬 검증 기록이다. 이전 main 기준 JavaScript 9개·Python 19개와 이번 결과를 구분한다.

## 실행한 검증
| 명령 | 결과 | 검증 범위 |
|---|---|---|
| npm.cmd test | 15개 통과 | 네이버 대표 DOM/JSON-LD·작성/수정일·링크/인용·잘림·추출 실패, 입력 캐시·갱신 순서, 카드 독립 토글·로딩/오류·출처 참조, 안전한 렌더링·계약·API 오류 |
| npm.cmd run typecheck | 통과 | Pydantic과 대응하는 TypeScript 계약 및 기존 기본값 호환 |
| npm.cmd run build | 통과 | 확장 JavaScript 구문·manifest 진입점 및 dist/newscheck 패키지 |
| npm.cmd run test:browser | 통과 | 실제 Chrome headless에서 패널 6개·키보드 토글·상태 유지·가로 넘침·시연 표시·Hover 지연/취소·선택 메시지 |
| .venv/Scripts/python.exe -m pytest -q | 35개 통과 | 원문/발언자·출처 ID/인용 거부, 출처/주의사항 상태, 원문 확보 허용 목록, 공급자 오류/Retry-After, 입력 기반 Mock·이벤트·위치·주의사항 참조, 캐시·API·스키마 snapshot |
| .venv/Scripts/python.exe scripts/smoke_backend.py | 통과 | 실제 로컬 Uvicorn HTTP의 health·기사·preview·문장 선택, 같은 article_id/body_hash/is_demo 및 출처 |
| npm.cmd run test:integration | 통과 | 합성 네이버 DOM → 실제 worker/API 클라이언트 → 로컬 HTTP Mock Analyzer → 실제 UI의 A/B/C/D, 서버 중단·카드 오류·재시도 |
| node scripts/check-commit.mjs | 통과 | 추적/추가 후보 파일에서 제외 대상 및 고확률 비밀 패턴 검사; 비밀 값은 출력하지 않음 |
| git diff --check | 통과 | 변경 공백 오류 없음 |
| 로컬 문서 링크 검사 | 통과 | README/개발 문서의 상대 링크 대상 존재 |

자동 단위·회귀 테스트는 **JavaScript 15 + Python 35 = 50개**다. Chrome 브라우저·HTTP·A/B/C/D 통합 smoke는 별도 실행한다.
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
- 실제 Gemini 호출, 계정별 모델 가용성·구조화 출력 호환성, 주장/근거/발언자/문장 유형 추출 품질.
- 실제 Tavily 검색/extract의 원문·발행일·원자료 관계·요청 제한·응답시간, 출처 10개 관찰과 주의사항의 정확도.
- Chrome에 확장을 설치한 실제 네이버 기사 2~3건의 추출·Hover·패널·드래그·탭 이동·캐시 갱신.
- 실제 동적 목록·복합/부분 선택·접근성·화면낭독기·키보드 Hover 대체.
- 공개 기자 약력·기사 밖 배경 수집, 기사 전문 비교, 자동 backoff·요청/비용 제한·인증·지속 캐시·단계 스트리밍은 미구현.
유료 외부 API 요청은 수행하지 않았다. 다음 검증의 선행 조건·완료 조건·관련 파일은 TODO.md에 명시한다.

## Git 상태
기준 main/원격 HEAD는 기존 PR #1 병합 커밋 33b9b0a92475c9c7464f3def1e151dda4e852182다.
기본 구현 단계에서는 feature/core-flow-integration에 로컬 변경만 유지했다. 이후 사용자 요청에 따라 변경을 커밋·Push하고 main 대상 PR을 생성한다. Merge와 Issues 생성은 이번 범위에 포함하지 않는다.
