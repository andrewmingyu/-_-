# API 명세 — source-tracing-v1 / 데이터 보완 1.9
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
| POST /api/words/explain | WordRequest | WordAnalysis | 단어의 사전/일반 의미와 문맥 설명 |

health 응답:
```json
{"status":"ok","mode":"mock","schema_version":"source-tracing-v1","data_version":"source-tracing-v1.9"}
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
- schema_version은 source-tracing-v1, data_version 기본값은 source-tracing-v1.9이다. 기존 클라이언트의 기본 필드를 유지하고 추가 항목은 기본값으로 생략 입력을 허용한다.
- ArticleContext: cited_links의 각 항목은 url/text/article_quote이며 기사에서 수집한 링크다. 직접 링크라도 검색에서 확인되지 않은 새 출처로 저장하지 않는다. quotations는 원문에 있는 인용, body_truncated는 잘림 여부다.
- Claim/Mention/TimelineItem.article_span: start/end/quote, 정규화 page_text의 Unicode 문자 기준, 서버 산출.
- EventInfo: description/article_quote/time/location. quote가 본문에 있고 time/location이 그 인용에 포함돼야 한다.
- TimelineItem.source_ids: 실제 확보한 출처와 연결되는 경우만 저장.
- Source.author: 작성자 관찰, facts.authorship 추가. content_status는 retrieved/snippet_only/unavailable/unknown이다.
- Decision.details: {reason, source_ids[], claim_ids[]} 목록. 이유와 출처/주장을 연결하며 허구 참조는 거부한다. 기존 reasons[]도 유지한다.
- RelatedArticle.topic/summary: 검색 주제 및 공급자 검색 요약. 독립성이나 주장의 진위 판정은 생성하지 않는다.
- RelatedArticle.id: 검색 URL에서 서버가 부여한 report ID. comparison_basis는 body_excerpt/search_snippet/title_only/unknown, comparison_status는 not_compared/compared/insufficient/failed다.
- comparison_points: {kind:common|difference, aspect:topic|event|actors|time|figures|attribution|focus|context, article_quote, related_quote, related_quote_ko?, explanation?}. related_quote_ko·explanation은 선택이며 원문이 외국어일 때 번역과 달라진 점의 한 문장 설명이다(판정 표현 금지). 양쪽 실제 인용(8~600자)을 모두 확인한 항목만 최대 6개 저장한다. compared에는 report ID·확인된 비교 범위·비교 항목이 필요하다.
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

## 제목 설명·짧은 맥락 표현 (data_version 1.7)
ArticleAnalysis.headline_explanation은 {meaning, reasons[]}이며 생략 시 빈 값으로 호환한다. meaning은 최대 600자, 이유는 최대 4개다. 각 이유는 text(독립적인 간결한 표현, 최대 240자), article_quote(실제 본문 연속 인용, 최대 2,000자), claim_ids, mention_ids, source_ids, article_span으로 구성한다.
서버는 존재하지 않는 인용을 버리고 유효한 주장·근거 ID만 보존한다. source_ids는 연결된 실제 출처에서 서버가 채운다. 이유를 확인할 수 없으면 의미를 임의로 만들지 않고 빈 설명을 반환한다.
TimelineItem에 label(최대 24자, 기본 빈 문자열), is_main_event(기본 false)를 추가하고 EventInfo에도 label을 추가한다. 날짜와 원문 description/article_quote는 보존한다. 서버는 유효한 사건 중 주요 사건 표시를 하나로 정리한다. API 경로·schema_version은 유지하며 응답·health·캐시의 data_version은 source-tracing-v1.9으로 통일한다.

## 빠른 Preview (data_version 1.7)
POST /api/preview는 완료된 전체 분석 캐시가 있으면 그 결과에서 응답을 만들고, 없으면 Gemini의 기사 추출까지만 수행한다. cold preview의 claims/major_evidence/sources는 빈 목록, search_status는 not_run이다. 이는 원출처 미발견이나 사실 확인이 아니다. 응답 필드는 호환성을 위해 유지한다. 이후 전체 분석과 같은 article_id/body_hash 및 추출 결과를 공유한다.

## 클라이언트 표시 상태 (2026-11-14)
sourceNotice()는 기존 응답에서 {level, icon, text, issues, incomplete, partial}을 도출한다. level은 clear/caution/unknown이며 issues는 {code,text,claim_ids,source_ids} 목록이다. 서버 응답 필드가 아니므로 기존 Pydantic·TypeScript API 계약과 JSON Schema는 변경하지 않는다. score/percent/factors는 생성하지 않는다. 서버의 unknown_fields와 neutral 날짜 안내는 보존하되 그것만으로 매체/기사의 낮은 신뢰 등급을 만들지 않는다.

## 선택 문맥 범위·단어 API (2026-11-14)
SelectionRequest/SelectionAnalysis에 context_scope=article|page_excerpt를 추가한다(기본 article, 이전 클라이언트 호환). page_excerpt는 기사 전체가 아니므로 전체 기사 인덱스로 저장하지 않는다. selected_text는 문장 2~3,000자이며 본문/발췌에 실제 포함되어야 한다.
WordRequest는 AnalyzeRequest에 selected_text(단어 하나, 1~80자), surrounding_text(최대 6,000자), context_scope를 더한다. 단어와 인용은 실제 page_text에서 대조한다. 잘못된 선택은 422, 공급자 오류는 기존 구조/코드/재시도 정보를 사용한다.
WordAnalysis 필드: word_id, selected_text, lemma, general_meaning, contextual_meaning, context_quote, dictionary_meaning, dictionary_status, dictionary_sources, context_scope, is_demo, pipeline_errors.
dictionary_status는 found(원문 확보 및 인용 확인), search_only(검색 요약 인용만 확인), not_found(관련 뜻풀이 미확인), failed(검색 실패)다. dictionary_sources는 서버 발급 id·실제 검색 url·title·excerpt·basis(retrieved|search_snippet)만 포함한다. 미확인/실패 상태는 dictionary_meaning과 출처 목록을 비우며 general_meaning을 AI 설명으로 구분한다.
예: 요청 {"url":"https://example.org/page","page_text":"협상이 실패하면 벼랑 끝에 몰릴 수 있다.","selected_text":"벼랑","surrounding_text":"협상이 실패하면 벼랑 끝에 몰릴 수 있다.","context_scope":"page_excerpt"}.
출처 ID/URL 또는 문맥 인용을 생성해 채우지 않는다. API 키는 서버에서만 관리한다. 새 모델도 api.schema.json과 shared/types.ts에 반영한다.

## 보도 충돌·인용 표현 재확인 필드 (2026-11-14)
RelatedArticle에 cited_by_article(boolean, 기본 false), 비교 point에 review_kind(none|claim_conflict|citation_difference, 기본 none), context_anchor(최대 120자), review_status(none|needs_confirmation|paired_excerpt, 기본 none)를 추가한다. 기존 응답은 기본값으로 호환한다.
Gemini 후보 ComparisonCandidatePoint에는 review_status가 없다. 서버만 최종 상태를 부여한다. paired_excerpt는 body_excerpt 범위와 양쪽 인용에 실제 포함된 2자 이상 공통 표현이 필요하다. citation_difference는 서버가 확인한 cited_by_article=true가 필수다. 그 외 자료 범위/맥락 부족은 needs_confirmation이다. common이나 focus/context/topic의 단순 차이는 재확인 경고로 승격하지 않는다.
클라이언트 파생 issue는 report_ids와 severity=caution|review를 추가해 정확한 보도 링크와 이동을 제공한다. review가 하나라도 있으면 전체 표시 level=review이며 미완료는 별도로 함께 표시한다. 점수·확률·사실/거짓 응답 필드는 없다.

## 원격 main 통합 계약 (2026-11-14)
- Claim/Mention의 translation은 원문과 분리한 선택적 한국어 AI 번역이다. 원문의 original_text/article_quote와 본문 이동은 그대로 유지한다.
- ComparisonCandidatePoint/ReportComparisonPoint의 related_quote_ko(최대 700자), explanation(최대 300자)를 review_kind/context_anchor/review_status와 함께 보존한다. 번역과 차이 설명은 AI 생성이며 실제 원문 인용의 존재 검사를 대체하지 않는다.
- RelatedArticle.original_candidate(boolean, 기본 false)는 공식 도메인·추정 영문 제목/번역 단어로 찾은 원문 후보를 나타낸다. 이 값으로 Source.original_status 또는 discovery를 승격하지 않는다. 실제 인용 관계인 cited_by_article, 원본 확인인 original_found와 별개다.
- is_original/is_original_candidate는 서버가 비교 프롬프트에 보내는 구분이다. 후보의 인용 관계를 모델이 확정할 수 없다. 기존 API 경로는 유지하고 스키마/캐시/health 버전은 source-tracing-v1.9로 통일한다.
