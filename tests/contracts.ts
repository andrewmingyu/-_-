import type { SourceStatus, CautionStatus, Claim, ArticleAnalysis, AnalyzeRequest } from '../newscheck 4/shared/types.js';
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
