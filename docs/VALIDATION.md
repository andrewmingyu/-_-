# 기준 버전 검증 결과
기준일: 2026-11-11 (Asia/Seoul). source-tracing-v1 / 확장 0.2.0.
이 문서는 PR 제출 직전 로컬 소스 기준의 실행 증거이다. 원격 CI와 Merge 후 재검사 결과는 PR 검사 및 최종 작업 보고에서 확인한다.

## 실제 실행한 검사
| 검사 | 결과 | 범위 |
|---|---|---|
| npm.cmd test | 9개 통과 | 6개 카드 독립 토글/상태 유지, 시연 표시, 안전 렌더링, 계약/참조, 발행자 중복, 설정/권한, 세 응답 시연/상태 검사, HTTP 429·네트워크 실패 |
| npm.cmd run typecheck | 통과 | TS 계약, 제거 필드 거부, 요청 metadata 기본값·null 일치 |
| npm.cmd run build | 통과 | 모든 확장 JS 문법, manifest 진입점, dist/newscheck 패키징 |
| npm.cmd run test:browser | 통과 | 설치된 Chrome headless의 440px 패널, 6개 카드, Enter/Space, 갱신 후 상태, 시연 링크, 가로 넘침, Hover 지연·선택 메시지 |
| .venv/Scripts/python.exe -m pytest -q | 19개 통과 | 기사 원문 보존, 상태·주의사항, 허구 ID/인용 제거, 검색 실패·빈 결과, 재인용, 같은 기관의 다른 문서, 방법·이해관계·날짜, 캐시/선택/스키마/API |
| .venv/Scripts/python.exe scripts/smoke_backend.py | 통과 | 실제 임시 로컬 Uvicorn HTTP의 health·기사·preview·선택, 동일 분석 ID/출처/is_demo |
| node scripts/check-commit.mjs | 통과 | 커밋 후보의 제외 파일·고확률 키 패턴; 값은 출력하지 않음 |
| git diff --check | 통과 | 변경 공백 오류 없음 |

총 자동 테스트는 JavaScript 9 + Python 19 = **28개**이다. 브라우저·HTTP smoke는 별도 검사다.
초기 보고의 24개는 당시 결과이며 안정화 회귀를 추가한 현재 수치로 대체한다.
공급자 malformed 응답의 비노출 502 처리, metadata null/기본 입력, 응답 marker/출처 상태,
요청 제한 오류, 캐시 만료/용량/깊은 복사를 보강했다.

## 환경과 경고
로컬 Windows, Node 24, Python 3.12 프로젝트 가상환경, 설치된 Chrome을 사용했다.
Python 의존성은 backend/requirements.lock.txt, Node는 package-lock.json에 기록한다.
pytest에서 Starlette TestClient의 httpx 사용 폐기 예정 경고 1개가 있다. 테스트 실패는 없으며 경고를 숨기지 않았다.
CI는 .github/workflows/ci.yml에서 Windows/Node24/Python3.12로 같은 mock 검사를 실행하도록 구성했다.
원격 CI 결과는 실행되기 전부터 성공했다고 간주하지 않는다.

## 실행하지 않은 검사
- 실제 Gemini 호출·모델 가용성·추출/출처 관찰 정확도.
- 실제 Tavily raw_content·원출처·발행일·검색 품질·할당량·응답시간.
- Chrome 개발자 모드로 확장을 설치한 상태의 권한/서비스 워커/네이버 실제 DOM/탭 이동.
- 실제 기사 2~3건의 사용자 검토, 화면낭독기·키보드 Hover 대체·여러 도메인.
외부 API 키는 사용하지 않았다. 실제 설치·API 시나리오는 README와 TODO의 P0/P1에 있다.

## 검증 방법의 한계
브라우저 검사는 실제 Chrome 엔진에서 UI·content script를 실행하지만 chrome.runtime API는 대체한다.
Python 테스트는 공급자를 FakeLLM/FakeSearch로 대체한다.
HTTP smoke는 실제 socket 서버이지만 ANALYSIS_MODE=mock의 고정 가상 데이터다.
따라서 세 검사가 실제 네이버 기사 분석 품질이나 MV3 설치 동작을 입증하지 않는다.
검색 요약 관련 보도, 기사 내부 배경, 미수집 기자/사건 메타데이터의 한계를 PROJECT_SPEC에 별도 표시했다.
