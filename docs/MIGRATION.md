# 출처 추적 방식 변경 기록
## 변경 전 실제 상태
실행 코드는 newscheck 4의 순수 JavaScript 확장입니다. FastAPI/Pydantic/TS 타입과 6개 카드 UI는 아직 없었습니다.
기존 sidepanel.js의 점수·제목 비교·확인할 주장·통합 펼치기를 6개 독립 카드로 변경했습니다.
기사 추출, 원문 위치 이동, 아이콘, 서비스 워커 패널 열기, 설정 저장은 보존했습니다.

## 제거/이동
- analysis.js의 computeCredibility, credibilityBand 및 SOURCE_TYPE_SCORE/CREDIBILITY_WEIGHTS 제거.
- sidepanel.js의 match/conflict/nofound 기반 교차검증 표시, 신뢰도 원형 점수, 보도 수/기자/날짜 가중치 제거.
- llm.js의 직접 공급자 호출, verifyClaims/crossCheck 등의 사실 대조 프롬프트 제거. 서버 호출로 이동.
- 기존 문장 판정 상태 verification_status 및 relation_to_claim은 새 API에서 허용하지 않음.
- 기존 demo의 aiTitle/aiReporter/reporterItems/cross/claims.status/evidenceIdx를 새 공통 스키마로 교체.
- 브라우저 API 키 입력을 서버 주소 설정으로 변경. 이전 키를 자동 삭제하지 않고 별도 삭제 버튼 제공.
- 기존 자극 단어 하이라이트 버튼은 제거. 출처 관련 자동 사실/거짓 색칠 없음.
- 제목 표현 관련 기존 분석 유틸리티와 네이버 검색 모듈은 다른 팀 코드 보존을 위해 남기되 새 분석 경로에서 사용하지 않음.

## 새 계약
claim_type + source_status + source_ids + caution{status,reasons}.
sources에는 검색 URL/서버 ID, discovery, original_status, 원문 속성 excerpt/null, unknown_fields를 저장.
상세 정의는 PROJECT_SPEC.md 및 api.schema.json.
출처 속성을 다 찾지 못한 경우 unknown을 유지하고 확인되지 않은 내용을 '없음'으로 해석하지 않음.

## 수동 검토가 남은 항목
실제 Chrome 확장 수명주기/사이트 DOM 변화/네트워크 접근/실제 Gemini 모델 및 Tavily 결과 품질은 별도 확인.
실제 API 키는 테스트에서 사용하지 않으며 테스트 데이터는 공급자 대체 또는 명시된 가상 예시.
디자인 PNG는 원래 배치를 유지하나 예전 사실판정 표현의 근거로 사용하지 않음.

## 개발 기준 버전 안정화 (2026-11-11)
- 원격 main de18984 기준 기존 소스와 이번 출처 추적 구현을 별도 chore/source-tracing-baseline 브랜치로 정리.
- 공급자 ValueError/잘못된 구조를 사용자 입력 오류(422)와 분리하여 일반화한 502로 처리. 실제 잘못된 기사 입력은 422 유지.
- Pydantic의 기본값·null 허용과 일치하도록 TypeScript 요청 metadata를 partial/null 입력으로 보완.
- 세 응답 화면에서 is_demo 및 출처 상태/기본 필드를 검사하고 429·네트워크 오류 회귀 추가.
- 캐시 TTL/128건 용량/깊은 복사 및 공급자 오류 비노출 테스트 보강.
- .env 변형/개인키/빌드 산출물 제외와 커밋 검사 추가. GitHub PR/main CI에서 같은 mock 검사를 실행.
- 요구사항의 25개 현황과 ARCHITECTURE/API_SPEC/AI_PIPELINE/UI_SPEC/TODO/CONTRIBUTING을 정리. 역할·담당자·Issues 생성은 없음.
- 새로운 사용자 기능이나 기술 스택 교체는 이번 안정화에서 추가하지 않음.

## 핵심 흐름 기본 구현 보완 (로컬 작업)
- 기존 6개 카드·토글·JS/FastAPI 구조는 보존. 미연결 구간만 보완.
- 기사 JSON-LD/수정일/본문 링크·인용·잘림·사건 정보를 수집하고 본문 날짜를 보도일로 추정하지 않음.
- 기존 POST 경로 유지, GET /api/articles/{article_id} 조회 1개만 추가. v1 기본 계약 유지 및 추가 데이터 버전 1.1.
- 고정 서버 Mock를 입력 기반 Mock 공급자가 동일 파이프라인을 실행하도록 변경. 정적 UI ?demo는 유지.
- 출처 작성자, 원문 보강, 사건/타임라인 출처, 주의사항의 근거 참조, 위치, 카드별 상태를 연결.
- 워커의 수집 전 캐시 조회/본문 해시 확인, HTML 중복 방지, 늦은 결과의 오래된 입력 덮어쓰기 방지.
- 새 선택 분석의 claim ID를 별도 namespace로 구분하고 부모 article_id·analysis_id·matched_claim_ids를 함께 반환.
- 공급자별 오류 및 Retry-After를 구분하고 실제 API 키 없이 SDK/HTTP 대체와 A/B/C/D 통합을 검사.
- 기본 구현 단계에서는 feature/core-flow-integration의 로컬 변경으로 유지했다. 후속 사용자 요청으로 동일 변경을 커밋·Push하고 main 대상 PR을 생성한다. Merge는 별도 범위다.
