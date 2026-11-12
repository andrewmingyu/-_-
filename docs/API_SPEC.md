# API 명세 — source-tracing-v1 / 데이터 보완 1.3
구현 기준: backend/app/main.py·models.py, newscheck 4/shared/types.ts.
서버 자동 문서: http://127.0.0.1:8000/docs. 기계 판독 스키마: [api.schema.json](api.schema.json).
모든 JSON은 UTF-8이고 Content-Type은 application/json이다.

## 엔드포인트
| 메서드·경로 | 입력 | 응답 | 용도 |
|---|---|---|---|
| GET /health | 없음 | status, mode, schema_version, data_version | 서버·모드 확인 |
| GET /api/articles/{article_id}?url=... | 분석 ID·선택 URL | ArticleAnalysis 또는 404 | 만료 전 기존 결과 조회 |
| POST /api/articles/analyze | AnalyzeRequest | ArticleAnalysis | 기사 전체 출처 분석 |
| POST /api/preview | AnalyzeRequest | Preview | 같은 분석의 Hover 표현 |
| POST /api/claims/check | SelectionRequest | SelectionAnalysis | 선택 문장 유형·출처 |

health 응답:
```json
{"status":"ok","mode":"mock","schema_version":"source-tracing-v1","data_version":"source-tracing-v1.3"}
```

## 요청
```json
{
  "url": "https://news.example/article/1",
  "title": "지원제도 개편 검토",
  "page_text": "기관은 지원제도 개편을 검토하고 있다고 밝혔다.",
  "metadata": {
    "url": "https://news.example/article/1",
    "publisher": "가상신문",
    "author": "가상기자",
    "published_at": "2026-11-09T10:24:00+09:00"
  },
  "refresh": false
}
```
형식 예시이며 실제 기사나 출처가 아니다.

| 필드 | 타입·제한 | 규칙 |
|---|---|---|
| url | HTTP(S) 문자열, 필수 | 인증정보를 포함한 URL은 거부 |
| title | 문자열, 최대 500자, 기본 빈 문자열 | 제목만으로 분석하지 않음 |
| page_text | 문자열, 최대 60,000자 | 모델 기본값은 빈 문자열이나 처리 시 공백 본문은 422 |
| metadata | ArticleMetadataInput 또는 null, 선택 | url은 필수, 그 외 Article 필드는 생략 가능 |
| refresh | boolean, 기본 false | 완료 캐시를 건너뛰며 진행 중 동일 작업은 공유 |
| article_context | 선택 객체, 기본 빈 값 | cited_links(최대30), quotations(최대30), body_truncated |
| article_id | 선택 요청에서만 선택 문자열 | 현재 기사 결과와 다르면 422 |
| selected_text | 선택 요청에서 2~3,000자 필수 | page_text에 포함돼야 함 |
| surrounding_text | 선택 요청에서 최대 6,000자, 기본 빈 문자열 | 클라이언트의 보조 문맥; 서버는 전체 page_text를 문맥으로 사용 |

Article 메타데이터: url, title, publisher, author, published_at, updated_at, event_time, event_location, author_profile_url.
title 기본값은 빈 문자열, url 외 나머지 정보는 기본 null이다. 응답에는 기본값까지 직렬화한다.
TS 입력 ArticleMetadataInput은 생략 가능한 기본 필드를 표현하고, 응답 Article은 모든 필드를 가진다.
Pydantic extra=forbid이므로 정의하지 않은 필드는 422다.

선택 요청은 위 요청에 다음 필드를 더한다:
```json
{
  "article_id": "현재_응답의_article_id",
  "selected_text": "지원제도 개편을 검토하고 있다고 밝혔다.",
  "surrounding_text": "기관은 지원제도 개편을 검토하고 있다고 밝혔다."
}
```

## ArticleAnalysis 응답
아래는 최소한의 유효 응답 형태 예시이다. 정적 UI 예시는 newscheck 4/data/demo.json에 있다. 서버 Mock는 입력에 따라 같은 파이프라인에서 생성하므로 이 고정 파일을 반환하지 않는다.
```json
{
  "schema_version": "source-tracing-v1",
  "article_id": "example_analysis",
  "body_hash": "example_sha256",
  "analysis_status": "partial",
  "is_demo": true,
  "article": {
    "url": "https://news.example/article/1",
    "title": "가상 기사",
    "publisher": null,
    "author": null,
    "published_at": null,
    "updated_at": null,
    "event_time": null,
    "event_location": null,
    "author_profile_url": null
  },
  "one_line_summary": "형식 설명용 시연입니다.",
  "context_timeline": [],
  "claims": [],
  "evidence_mentions": [],
  "sources": [],
  "caution": {"status":"unknown","reasons":["출처 분석 정보가 부족합니다."]},
  "related_articles": [],
  "headline_difference": "표현 차이 미확인",
  "final_comment": "출처 확인은 주장의 진실성을 입증하지 않습니다.",
  "search_status": "not_run",
  "search_errors": [],
  "analyzed_at": "2026-11-11T00:00:00+00:00"
}
```

| 결과 필드 | 의미 |
|---|---|
| article_id / body_hash | 입력 기반 분석 키 식별자 / 본문 SHA-256; 서버 Mock도 입력과 연결 |
| analysis_status | complete 또는 partial; 진위/확률이 아님 |
| is_demo | boolean 필수. 시연 결과 오인 방지 |
| one_line_summary | 문자열 유지. 짧은 1~2문장을 줄바꿈으로 구분하도록 요청. UI는 글머리표로 표시하며 기존 문단 응답도 호환 |
| context_timeline | date, description, article_quote. 기사 내부 내용만 |
| claims | 원문·유형·발언자·근거/출처 참조·원출처 상태·주의사항 |
| evidence_mentions | 기사 자체가 근거로 제시한 자료/발언 |
| sources | 실제 검색에서 확보한 출처 |
| caution | 기사 전체의 주의 상태와 이유 |
| related_articles | 최대 5건. URL·제목·발행자/시점·검색 요약·독립성 설명. 앞 3건까지 보도 비교 수행 |
| headline_difference | 제목과 본문의 표현 차이 |
| final_comment | 출처 관찰 범위의 안내; 진위 판정 없음 |
| search_status / search_errors | 원출처 검색 상태 / 검색·속성 정리·관련 보도 단계 오류 |
| analyzed_at | 분석 결과 생성 시각 |

## 중첩 데이터
Claim: id, original_text, claim_text, claim_type, speaker, mention_ids[], source_ids[], source_status, caution.
claim_type: factual_narration / quotation / opinion / interpretation / prediction / context / statistics / unknown.
Mention: id, claim_ids[], description, article_quote, source_label, document_title, source_kind, anonymous.
Source: id, url, title, publisher, published_at, retrieved_at, discovery, mention_ids[], source_kind,
original_status, facts, unknown_fields[], summary, caution.
discovery는 article_cited 또는 external_found이다. 기사 인용 자료와 단순 외부 발견을 구분하며 진실성을 뜻하지 않는다.
facts의 각 속성은 {"excerpt":"확보한 원문의 연속된 인용"} 또는 null이다.
속성: identity, originality, expertise, information_access, date_context, public_access, methodology, interests, independence.

원출처 상태: original_found / secondary_only / source_not_found / unknown.
주의사항 상태: caution / none_identified / unknown.
caution.reasons는 공백이 아닌 문자열 한 개 이상이다.
출처 ID는 서버가 검색 결과에 부여하며 모델의 새로운 URL·ID는 채택하지 않는다.
없는 claim/mention/source 참조는 결과 검증에서 거부한다.

## Preview 및 SelectionAnalysis
Preview는 article_id, is_demo, summary, `major_evidence[]` (최대 2), `sources[]` (참조에 필요한 전체 출처),
headline_difference, one_line_caution, search_status를 포함한다. 추가 필드는 claims(최대2), body_hash, data_version, pipeline_errors다. UI에서 출처는 최대2개를 간략히 표시한다.
one_line_caution은 기사 caution의 첫 이유이며 전체 사유는 상세 분석에 존재한다.
```json
{
  "article_id":"example_analysis","is_demo":true,"summary":"시연용 요약",
  "major_evidence":[],"sources":[],"headline_difference":"표현 차이 미확인",
  "one_line_caution":"출처 분석 정보가 부족합니다.","search_status":"not_run"
}
```
SelectionAnalysis는 article_id, selected_text, is_demo, claims[], sources[], caution을 포함한다. 추가로 analysis_id, matched_claim_ids, evidence_mentions, pipeline_errors를 반환한다. article_id는 항상 부모 기사이고 새 선택은 별도 analysis_id 및 scoped claim ID를 가진다.
```json
{
  "article_id":"example_analysis","selected_text":"선택한 문장","is_demo":true,
  "claims":[],"sources":[],
  "caution":{"status":"unknown","reasons":["출처 분석 정보가 부족합니다."]}
}
```
세 화면의 같은 요청은 같은 Analyzer 캐시를 사용한다. 새로운 선택 focus의 별도 분석은 기사 전체 캐시를 대체하지 않는다.

## 오류와 요청 제한
| 상황 | 실제 처리 |
|---|---|
| 잘못된 JSON/필드/URL/길이 | FastAPI 422 validation error의 detail 배열 |
| 본문 없음, 선택이 본문에 없음, article_id 불일치 | 422 + {"detail":"설명"} |
| 전체 공급자 설정 누락 | 503, code=configuration_missing |
| 전체 공급자 호출 한도 | 429, code=rate_limited, 가능한 Retry-After |
| 전체 공급자 시간 초과 | 504, code=timeout |
| 공급자 인증/권한/모델·경로/요청 형식 오류 | 502, authentication_failed/permission_denied/request_not_found/invalid_request; 공급자 원문은 숨김 |
| 공급자 결제·사용량 문제/서비스 장애 | 503, billing_required/provider_unavailable; 가능한 Retry-After 전달 |
| 공급자 형식/연결/기타 오류 | 502, invalid_response/network_error/provider_error; 내부 원문·키 비공개 |
| Tavily 원출처 검색 실패 | HTTP 200의 partial 결과, failed·unknown 및 search_errors |
| 출처 속성 정리 실패 | partial·unknown; 원출처 검색 자체의 상태와 별도 설명 |
| 관련 기사 검색 실패 | partial 및 별도 search_errors; 원출처 검색 실패로 바꾸지 않음 |
| 부분 단계의 공급자 오류 | HTTP 200 partial 결과의 pipeline_errors에 phase/code/provider/retry_after_seconds 기록; source_search 실패와 document_fetch 실패 구분 |
| 클라이언트 네트워크/HTTP 실패 | 팝업/패널 오류 표시; source_not_found 결과로 대체하지 않음 |

서버 인증·사용자별 quota·자동 backoff·Retry-After에 따른 자동 대기/재시도는 아직 없다. Retry-After 값의 파싱·응답 전달은 구현되어 있다. 외부 공개 배포 전에 제한 정책을 별도 구현한다.

## 추가 필드와 기본값 (기존 경로 유지)
- schema_version은 source-tracing-v1, data_version 기본값은 source-tracing-v1.3이다. 기존 클라이언트의 기본 필드를 유지하고 추가 항목은 기본값으로 생략 입력을 허용한다.
- ArticleContext: cited_links의 각 항목은 url/text/article_quote이며 기사에서 수집한 링크다. 직접 링크라도 검색에서 확인되지 않은 새 출처로 저장하지 않는다. quotations는 원문에 있는 인용, body_truncated는 잘림 여부다.
- Claim/Mention/TimelineItem.article_span: start/end/quote, 정규화 page_text의 Unicode 문자 기준, 서버 산출.
- EventInfo: description/article_quote/time/location. quote가 본문에 있고 time/location이 그 인용에 포함돼야 한다.
- TimelineItem.source_ids: 실제 확보한 출처와 연결되는 경우만 저장.
- Source.author: 작성자 관찰, facts.authorship 추가. content_status는 retrieved/snippet_only/unavailable/unknown이다.
- Decision.details: {reason, source_ids[], claim_ids[]} 목록. 이유와 출처/주장을 연결하며 허구 참조는 거부한다. 기존 reasons[]도 유지한다.
- RelatedArticle.topic/summary: 검색 주제 및 공급자 검색 요약. 독립성이나 주장의 진위 판정은 생성하지 않는다.
- RelatedArticle.id: 검색 URL에서 서버가 부여한 report ID. comparison_basis는 body_excerpt/search_snippet/title_only/unknown, comparison_status는 not_compared/compared/insufficient/failed다.
- comparison_points: {kind:common|difference, aspect:topic|event|actors|time|figures|attribution|focus|context, article_quote, related_quote}. 양쪽 실제 인용(8~600자)을 모두 확인한 항목만 최대 6개 저장한다. compared에는 report ID·확인된 비교 범위·비교 항목이 필요하다.
- common은 공통 보도 항목, difference는 표현·강조 차이다. 근거의 지지/반박이나 진위 상태가 아니다. differences_summary는 검증된 항목의 종류를 서버가 짧게 조합한 설명이다.
- 이전 응답의 비교 필드 생략은 id='', basis=unknown, status=not_compared, points=[]로 호환한다. 비교 실패는 related_comparison 단계 오류이며 기존 기사 목록을 유지한다.
- ArticleAnalysis.section_states: context/metadata/claims/evidence/cautions/related의 {status,message}. status는 ready/empty/partial/error. 요청 중 loading은 클라이언트 표시 전용이다.
- PipelineError: phase, code, message, provider, retry_after_seconds. phase는 source_search/document_fetch/source_review/related_search 등을 구분한다.
- GET lookup은 TTL이 지난 결과를 반환하지 않고 url이 다르면 404다. refresh와 TTL이 캐시 관리의 기본 수단이며 중복된 cache POST/DELETE API는 추가하지 않는다.
- 조회 URL의 형식 오류는 캐시가 비었거나 ID가 없어도 422로 반환한다. 원출처 검색이 필요 없어 search_status=not_run인 결과도 오류가 없으면 캐시에 저장할 수 있다.

구조화된 전체 오류 예시:
```json
{"detail":"공급자의 요청 한도에 도달했습니다.","error":{"code":"rate_limited","provider":"gemini","retry_after_seconds":12}}
```
