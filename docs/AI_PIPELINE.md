# AI 출처 분석 파이프라인
이 서비스는 기사의 진실·거짓, 주장-근거 논리 타당성이나 일치/반박을 판정하지 않으며 점수·확률을 생성하지 않는다.

## 1. 기사와 메타데이터 수집
확장이 제목·본문·언론사·기자·게시/수정일·URL을 추출한다. 본문은 기존 추출기의 12,000자 제한이 있다.
JSON-LD Event의 날짜·장소가 실제 본문에 있는 경우와 Gemini EventInfo의 인용에 포함된 날짜·장소를 연결한다. 없는 값은 null이다. 기자 프로필 독립 수집은 아직 없다. 기사 내부 링크·인용·본문 잘림은 ArticleContext에 담는다.
본문이 없으면 실패한다. 제목만으로 본문 요약을 만들지 않는다.

## 2. 핵심 주장 및 기사 내부 근거
Gemini에 제목·본문(선택 시 focus)을 비신뢰 DATA로 제공한다.
Extraction 스키마로 요약·최대 3개 claims·evidence_mentions·기사 내부 timeline·제목 표현 차이를 받는다.
사실 서술/인용/의견/해석/예측 등의 유형은 진위 상태가 아니다.
서버는 original_text/article_quote가 실제 본문에 포함되는지 확인하고 speaker·자료명·출처 표기를 검사한다.
claim_text는 원문으로 다시 설정하여 '검토'를 '확정'으로 바꾸는 재서술을 방지한다.
인용 포함 검사만으로 의미·발언 귀속이 정확하다고 보증하지는 않으므로 실제 표본 평가가 필요하다.

## 3. 근거의 원출처 검색
기사 근거의 source_label/document_title/article_quote에서 최대 3개 검색어를 만든다.
Tavily 일반 검색으로 질의별 최대 5건 및 raw_content를 요청한다.
URL 정규화와 동일 URL 중복 제거 후 서버가 해시 기반 source ID를 부여한다.
제목/URL/published_date/retrieved_at과 원문 앞 16,000자를 보존해 다음 단계에 제공한다.
검색 요약은 탐색 힌트이며 raw_content가 없으면 이를 원문 관찰로 대체하지 않는다.
실제 검색 실패·완료된 빈 결과·근거 언급 자체 없음은 각각 failed/completed/not_run으로 구분한다. raw_content가 없는 검색 URL 최대 3개는 Tavily extract로 보강한다. 반환 URL을 원래 후보 허용 목록과 대조하며 새 URL은 저장하지 않는다. 보강 실패는 검색 미발견과 구분하여 content_status/pipeline_errors에 기록한다.

## 4. 출처의 정체·원본 관계·전문성·검증 가능성
Gemini는 주어진 source ID에 한해서만 자료 연결과 SourceFacts의 정확한 원문 인용을 추출한다.
SourceFacts: identity, authorship, originality, expertise, information_access, date_context,
public_access, methodology, interests, independence. 없는 속성은 null이다.
서버가 실제 raw_content에 포함되지 않는 excerpt를 제거한다.
article_cited는 기사 자료명 또는 엄격한 기관·인용 연결이 확인되는 경우이고, 그 외는 external_found로 둔다.
같은 기관의 다른 자료나 주제 유사성만으로 기사 인용 자료라고 표시하지 않는다.
original_found는 자료 연결·원자료 인용·기관 정체를 함께 요구한다.
이 과정도 '최초 원본'의 완전한 증명은 아니며 원자료 관계를 사람이 검토해야 한다.
원문에 적힌 자기소개는 실제 전문자격/이해관계 부재에 대한 독립 증명으로 취급하지 않는다.

## 5. 출처 공신력 관련 관찰
임의 등급이나 유명세 기반 평가 대신 확인된 인용과 unknown_fields를 함께 제시한다.
기관·원자료·전문분야·접근 경로·시점·공개 범위·조사방법·이해관계·독립성 중 무엇이 관찰됐는지 설명한다.
공개 원문이 있다는 것, 기관이 공신력 있다는 것, 원본을 찾았다는 것을 주장 입증으로 바꾸지 않는다.

## 6. 객관적인 주의사항
일반 코드가 원출처 미발견/재인용/미명시/익명/조사방법 미확인/이해관계 관련 문구/날짜 차이/의견·예측을 안내한다.
자료가 기사보다 365일을 초과하여 오래되면 날짜 차이와 최신 자료 확인 필요성만 적는다.
양쪽 날짜나 속성이 없으면 미확인을 유지한다.
caution / none_identified / unknown과 비어 있지 않은 reasons를 저장한다. details에는 이유별 source_ids/claim_ids를 연결한다. 인용 위치는 서버가 article_span으로 산출한다.
none_identified는 현재 관찰 범위에서 별도 주의사항이 없다는 뜻이며 진위의 결론이 아니다.

## 7. 결과 저장과 전달
Pydantic 모델에 없는 필드와 알 수 없는 참조를 거부한다. 출처 URL은 검색에서 온 값만 사용한다.
완료/부분 분석 결과의 공통 ArticleAnalysis를 캐시하고 preview·selection 응답으로 필요한 필드만 전달한다.
UI는 source_status·caution을 표시하며 사실/거짓 자동 색상 강조는 하지 않는다.
독립성이나 관련 기사 전문 비교를 확인하지 못했으면 그렇게 명시한다.

## 평가 계획
단위 테스트는 공급자를 대체하며 정확한 제약·오류·캐시를 확인한다. 실제 모델 성능의 증거가 아니다.
P0에서 실제 기사 2~3건과 원문 자료를 저장 범위에 유의해 수동 대조하고,
추출 누락/의미 변경/잘못된 출처 연결/관찰 인용 오류/과잉·누락 주의사항을 유형별로 기록한다.
실제 API 키, 모델 가용성·할당량 및 응답시간은 이번 기준 버전에서 검증되지 않았다.

## 입력 기반 Mock와 실제 연결의 구분
MockLLM/MockSearch도 동일 Analyzer를 거친다. 기사 원문에서 2~3개 문장을 시연 추출하고, 명시적으로 일치하는 가상 자료만 fixture 검색으로 반환한다. 출처는 원문 인용/ID 검사와 동일 주의사항 규칙을 통과한다. 실제 AI 성능·검색 성공의 증거는 아니며 모든 화면의 is_demo 표시를 유지한다.
새 선택 분석은 부모 article_id와 별도의 analysis_id 및 scoped claim ID를 사용하고 원본 기사 결과를 덮어쓰지 않는다. 기존 주장 재사용 여부는 matched_claim_ids로 표현한다.
