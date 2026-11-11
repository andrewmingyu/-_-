export type SourceStatus = 'original_found' | 'secondary_only' | 'source_not_found' | 'unknown';
export type CautionStatus = 'caution' | 'none_identified' | 'unknown';
export type ClaimType = 'factual_narration' | 'quotation' | 'opinion' | 'interpretation' | 'prediction' | 'context' | 'statistics' | 'unknown';
export interface Decision { status: CautionStatus; reasons: string[] }
export interface Article { url: string; title: string; publisher: string | null; author: string | null; published_at: string | null; updated_at: string | null; event_time: string | null; event_location: string | null; author_profile_url: string | null }
export interface Mention { id: string; claim_ids: string[]; description: string; article_quote: string; source_label: string | null; document_title: string | null; source_kind: string; anonymous: boolean }
export interface Claim { id: string; original_text: string; claim_text: string; claim_type: ClaimType; speaker: string | null; mention_ids: string[]; source_ids: string[]; source_status: SourceStatus; caution: Decision }
export interface Observation { excerpt: string }
export type FactKey = 'identity' | 'originality' | 'expertise' | 'information_access' | 'date_context' | 'public_access' | 'methodology' | 'interests' | 'independence';
export interface Source { id: string; url: string; title: string; publisher: string | null; published_at: string | null; retrieved_at: string; discovery: 'article_cited' | 'external_found'; mention_ids: string[]; source_kind: string; original_status: SourceStatus; facts: Record<FactKey, Observation | null>; unknown_fields: string[]; summary: string; caution: Decision }
export interface TimelineItem { date: string; description: string; article_quote: string }
export interface RelatedArticle { url: string; title: string; publisher: string | null; published_at: string | null; differences_summary: string; independence: string }
export interface ArticleAnalysis { schema_version: 'source-tracing-v1'; article_id: string; body_hash: string; analysis_status: 'partial' | 'complete'; is_demo: boolean; article: Article; one_line_summary: string; context_timeline: TimelineItem[]; claims: Claim[]; evidence_mentions: Mention[]; sources: Source[]; caution: Decision; related_articles: RelatedArticle[]; headline_difference: string; final_comment: string; search_status: 'completed' | 'failed' | 'not_run'; search_errors: string[]; analyzed_at: string }
export type ArticleMetadataInput = Pick<Article, 'url'> & Partial<Omit<Article, 'url'>>;
export interface AnalyzeRequest { url: string; title?: string; page_text?: string; metadata?: ArticleMetadataInput | null; refresh?: boolean }
export interface SelectionRequest extends AnalyzeRequest { article_id?: string; selected_text: string; surrounding_text?: string }
export interface SelectionAnalysis { article_id: string; selected_text: string; is_demo: boolean; claims: Claim[]; sources: Source[]; caution: Decision }
export interface Preview { article_id: string; is_demo: boolean; summary: string; major_evidence: Mention[]; sources: Source[]; headline_difference: string; one_line_caution: string; search_status: 'completed' | 'failed' | 'not_run' }
