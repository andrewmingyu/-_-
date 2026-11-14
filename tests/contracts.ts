import type { SourceStatus, CautionStatus, Claim, ArticleAnalysis, AnalyzeRequest, ReportComparisonPoint, HeadlineExplanation, TimelineItem, WordRequest, WordAnalysis, SelectionRequest } from '../newscheck 4/shared/types.js';
const wordRequest:WordRequest={url:'https://generic.example',selected_text:'핵',context_scope:'page_excerpt'};
declare const wordResult:WordAnalysis;
const dictionaryStatus:'found'|'search_only'|'not_found'|'failed'=wordResult.dictionary_status;
// @ts-expect-error word explanations are not truth scores
wordResult.score;
const excerpt:SelectionRequest={url:'https://generic.example',selected_text:'선택한 문장입니다.',context_scope:'page_excerpt'};
const status: SourceStatus = 'original_found';
const caution: CautionStatus = 'unknown';
// @ts-expect-error old truth verdicts are not part of this API
const oldStatus: SourceStatus = 'supports';
// @ts-expect-error a cautious source is not a truth claim
const oldCaution: CautionStatus = 'verified';
declare const claim: Claim;
// @ts-expect-error removed field
claim.verification_status;
declare const analysis: ArticleAnalysis;
// @ts-expect-error removed score
analysis.credibility;
void [status,caution,oldStatus,oldCaution];
// Pydantic accepts omitted metadata fields/defaults and explicit null.
const minimal: AnalyzeRequest = { url: 'https://news.example/1', metadata: { url: 'https://news.example/1' } };
const nullable: AnalyzeRequest = { url: 'https://news.example/1', metadata: null };
const context: AnalyzeRequest = {url:'https://news.example/1',article_context:{cited_links:[{url:'https://source.example/1',text:'자료'}]}};
void [minimal, nullable, context];
const comparison: ReportComparisonPoint = {kind:'difference',aspect:'focus',article_quote:'현재 기사에서 실제로 인용한 구절',related_quote:'다른 보도에서 실제로 인용한 구절'};
// @ts-expect-error report comparisons are not support/contradiction verdicts
const truthComparison: ReportComparisonPoint['kind'] = 'supports';
void [comparison, truthComparison];
const headline: HeadlineExplanation = {meaning:'제도 개편 검토를 다룹니다.',reasons:[{text:'연구원이 검토 계획을 발표했습니다.',article_quote:'연구원은 개편을 검토한다고 밝혔다.',claim_ids:['c1'],mention_ids:[],source_ids:[]}]};
const timeline: TimelineItem = {date:'시점 미확인',label:'제도 개편 검토',is_main_event:true,description:'원문',article_quote:'원문'};
void [headline,timeline];
