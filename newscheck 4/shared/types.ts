export type SourceStatus = 'original_found' | 'secondary_only' | 'source_not_found' | 'unknown';
export type CautionStatus = 'caution' | 'none_identified' | 'unknown';
export type ClaimType = 'factual_narration' | 'quotation' | 'opinion' | 'interpretation' | 'prediction' | 'context' | 'statistics' | 'unknown';
export interface TextSpan { start:number; end:number; quote:string }
export interface CautionDetail { reason:string; source_ids:string[]; claim_ids:string[] }
export interface Decision { status:CautionStatus; reasons:string[]; details?:CautionDetail[] }
export interface ArticleLink { url:string; text:string; article_quote?:string }
export interface ArticleContext { cited_links:ArticleLink[]; quotations:string[]; body_truncated:boolean }
export interface EventInfo { label?:string; description:string|null; article_quote:string|null; time:string|null; location:string|null }
export interface PipelineError { phase:string; code:string; message:string; provider:string|null; retry_after_seconds:number|null }
export interface SectionState { status:'ready'|'empty'|'partial'|'error'; message:string|null }
export interface Article { url:string; title:string; publisher:string|null; author:string|null; published_at:string|null; updated_at:string|null; event_time:string|null; event_location:string|null; author_profile_url:string|null }
export interface Mention { id:string; claim_ids:string[]; description:string; article_quote:string; translation?:string|null; source_label:string|null; document_title:string|null; source_kind:string; anonymous:boolean; article_span?:TextSpan|null }
export interface Claim { id:string; original_text:string; claim_text:string; translation?:string|null; claim_type:ClaimType; speaker:string|null; mention_ids:string[]; source_ids:string[]; source_status:SourceStatus; caution:Decision; article_span?:TextSpan|null }
export interface Observation { excerpt:string }
export type FactKey = 'identity'|'authorship'|'originality'|'expertise'|'information_access'|'date_context'|'public_access'|'methodology'|'interests'|'independence';
export type SourceFacts = Record<Exclude<FactKey,'authorship'>,Observation|null> & {authorship?:Observation|null};
export interface Source { id:string; url:string; title:string; publisher:string|null; author?:string|null; published_at:string|null; retrieved_at:string; discovery:'article_cited'|'external_found'; mention_ids:string[]; source_kind:string; original_status:SourceStatus; facts:SourceFacts; unknown_fields:string[]; summary:string; caution:Decision; content_status?:'retrieved'|'snippet_only'|'unavailable'|'unknown' }
export interface TimelineItem { date:string; label?:string; is_main_event?:boolean; description:string; article_quote:string; article_span?:TextSpan|null; source_ids?:string[] }
export interface HeadlineReason { text:string; article_quote:string; claim_ids:string[]; mention_ids:string[]; source_ids:string[]; article_span?:TextSpan|null }
export interface HeadlineExplanation { meaning:string; reasons:HeadlineReason[] }
export type ReportAspect = 'topic'|'event'|'actors'|'time'|'figures'|'attribution'|'focus'|'context';
export interface ReportComparisonPoint { kind:'common'|'difference'; aspect:ReportAspect; article_quote:string; related_quote:string; related_quote_ko?:string|null; explanation?:string|null; review_kind?:'none'|'claim_conflict'|'citation_difference'; context_anchor?:string; review_status?:'none'|'needs_confirmation'|'paired_excerpt' }
export interface RelatedArticle { id?:string; url:string; title:string; publisher:string|null; published_at:string|null; differences_summary:string; independence:string; topic?:string|null; summary?:string|null; comparison_basis?:'body_excerpt'|'search_snippet'|'title_only'|'unknown'; comparison_status?:'not_compared'|'compared'|'insufficient'|'failed'; comparison_points?:ReportComparisonPoint[]; cited_by_article?:boolean; original_candidate?:boolean }
export interface RelatedVideo { id:string; url:string; title:string; channel:string; channel_label:string; thumbnail_url?:string|null; published_at?:string|null }
export interface ArticleAnalysis { schema_version:'source-tracing-v1'; data_version?:string; article_id:string; body_hash:string; analysis_status:'partial'|'complete'; is_demo:boolean; article:Article; one_line_summary:string; headline_explanation?:HeadlineExplanation; context_timeline:TimelineItem[]; claims:Claim[]; evidence_mentions:Mention[]; sources:Source[]; caution:Decision; related_articles:RelatedArticle[]; related_videos?:RelatedVideo[]; headline_difference:string; final_comment:string; search_status:'completed'|'failed'|'not_run'; search_errors:string[]; analyzed_at:string; event?:EventInfo; article_context?:ArticleContext; section_states?:Record<string,SectionState>; pipeline_errors?:PipelineError[] }
export type ArticleMetadataInput = Pick<Article,'url'> & Partial<Omit<Article,'url'>>;
export interface AnalyzeRequest { url:string; title?:string; page_text?:string; metadata?:ArticleMetadataInput|null; refresh?:boolean; article_context?:Partial<ArticleContext> }
export interface SelectionRequest extends AnalyzeRequest { article_id?:string; selected_text:string; surrounding_text?:string; context_scope?:'article'|'page_excerpt' }
export interface SelectionAnalysis { article_id:string; selected_text:string; is_demo:boolean; claims:Claim[]; sources:Source[]; caution:Decision; pipeline_errors?:PipelineError[]; analysis_id?:string|null; matched_claim_ids?:string[]; evidence_mentions?:Mention[]; context_scope?:'article'|'page_excerpt' }
export interface WordRequest extends AnalyzeRequest { selected_text:string; surrounding_text?:string; context_scope?:'article'|'page_excerpt' }
export interface DictionarySource { id:string; url:string; title:string; excerpt:string; basis:'retrieved'|'search_snippet' }
export interface WordAnalysis { word_id:string; selected_text:string; lemma:string; general_meaning:string; contextual_meaning:string; context_quote:string; dictionary_meaning:string; dictionary_status:'found'|'search_only'|'not_found'|'failed'; dictionary_sources:DictionarySource[]; context_scope:'article'|'page_excerpt'; is_demo:boolean; pipeline_errors:PipelineError[] }
export interface Preview { article_id:string; is_demo:boolean; summary:string; major_evidence:Mention[]; sources:Source[]; headline_difference:string; one_line_caution:string; search_status:'completed'|'failed'|'not_run'; claims?:Claim[]; body_hash?:string; data_version?:string; pipeline_errors?:PipelineError[] }
