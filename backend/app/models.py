"""Source tracing contract. No claim truth, probability or entailment fields."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

SourceStatus = Literal['original_found', 'secondary_only', 'source_not_found', 'unknown']
CautionStatus = Literal['caution', 'none_identified', 'unknown']
ClaimType = Literal['factual_narration', 'quotation', 'opinion', 'interpretation', 'prediction', 'context', 'statistics', 'unknown']
SearchStatus = Literal['completed', 'failed', 'not_run']


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class TextSpan(Model):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    quote: str


class CautionDetail(Model):
    reason: str = Field(min_length=1)
    source_ids: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)


class Decision(Model):
    status: CautionStatus = 'unknown'
    reasons: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)
    details: list[CautionDetail] = Field(default_factory=list)


class ArticleLink(Model):
    url: HttpUrl
    text: str = Field(max_length=500)
    article_quote: str = Field(default='', max_length=2000)


class ArticleContext(Model):
    cited_links: list[ArticleLink] = Field(default_factory=list, max_length=30)
    quotations: list[str] = Field(default_factory=list, max_length=30)
    body_truncated: bool = False


class EventInfo(Model):
    description: str | None = None
    article_quote: str | None = None
    time: str | None = None
    location: str | None = None


class PipelineError(Model):
    phase: str
    code: str
    message: str
    provider: str | None = None
    retry_after_seconds: int | None = None


class SectionState(Model):
    status: Literal['ready', 'empty', 'partial', 'error']
    message: str | None = None


class Article(Model):
    url: HttpUrl
    title: str = ''
    publisher: str | None = None
    author: str | None = None
    published_at: str | None = None
    updated_at: str | None = None
    event_time: str | None = None
    event_location: str | None = None
    author_profile_url: HttpUrl | None = None


class Mention(Model):
    id: str
    claim_ids: list[str] = Field(default_factory=list)
    description: str
    article_quote: str
    source_label: str | None = None
    document_title: str | None = None
    source_kind: str = 'unknown'
    anonymous: bool = False
    article_span: TextSpan | None = None


class Claim(Model):
    id: str
    original_text: str
    claim_text: str
    claim_type: ClaimType
    speaker: str | None = None
    mention_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    source_status: SourceStatus = 'unknown'
    caution: Decision = Field(default_factory=lambda: Decision(reasons=['출처 분석 전입니다.']))
    article_span: TextSpan | None = None


class Observation(Model):
    # A literal passage from the retrieved document, not a model reputation judgment.
    excerpt: str = Field(min_length=1, max_length=1200)


class SourceFacts(Model):
    identity: Observation | None = None
    authorship: Observation | None = None
    originality: Observation | None = None
    expertise: Observation | None = None
    information_access: Observation | None = None
    date_context: Observation | None = None
    public_access: Observation | None = None
    methodology: Observation | None = None
    interests: Observation | None = None
    independence: Observation | None = None


class Source(Model):
    id: str
    url: HttpUrl
    title: str
    publisher: str | None = None
    author: str | None = None
    published_at: str | None = None
    retrieved_at: str
    discovery: Literal['article_cited', 'external_found']
    mention_ids: list[str] = Field(default_factory=list)
    source_kind: str = 'unknown'
    original_status: SourceStatus = 'unknown'
    facts: SourceFacts = Field(default_factory=SourceFacts)
    unknown_fields: list[str] = Field(default_factory=list)
    summary: str
    caution: Decision
    content_status: Literal['retrieved', 'snippet_only', 'unavailable', 'unknown'] = 'unknown'


class TimelineItem(Model):
    date: str
    description: str
    article_quote: str
    article_span: TextSpan | None = None
    source_ids: list[str] = Field(default_factory=list)


class ReportComparisonPoint(Model):
    kind: Literal['common', 'difference']
    aspect: Literal['topic', 'event', 'actors', 'time', 'figures', 'attribution', 'focus', 'context']
    article_quote: str = Field(min_length=8, max_length=600)
    related_quote: str = Field(min_length=8, max_length=600)


class ReportComparison(Model):
    report_id: str
    points: list[ReportComparisonPoint] = Field(default_factory=list, max_length=6)


class ReportComparisons(Model):
    reports: list[ReportComparison] = Field(default_factory=list, max_length=3)


class RelatedArticle(Model):
    id: str = ''
    url: HttpUrl
    title: str
    publisher: str | None = None
    published_at: str | None = None
    differences_summary: str
    independence: str = '독립적인 자료에 기반했는지 확인하지 못했습니다.'
    topic: str | None = None
    summary: str | None = None
    comparison_basis: Literal['body_excerpt', 'search_snippet', 'title_only', 'unknown'] = 'unknown'
    comparison_status: Literal['not_compared', 'compared', 'insufficient', 'failed'] = 'not_compared'
    comparison_points: list[ReportComparisonPoint] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def comparison_is_grounded(self):
        if bool(self.comparison_points) != (self.comparison_status == 'compared'):
            raise ValueError('Comparison status requires paired quotes')
        if self.comparison_status == 'compared' and (not self.id or self.comparison_basis == 'unknown'):
            raise ValueError('Comparison requires a report ID and material scope')
        return self


class ArticleAnalysis(Model):
    schema_version: Literal['source-tracing-v1'] = 'source-tracing-v1'
    data_version: str = 'source-tracing-v1.3'
    article_id: str
    body_hash: str
    analysis_status: Literal['partial', 'complete']
    is_demo: bool = False
    article: Article
    one_line_summary: str
    context_timeline: list[TimelineItem] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    evidence_mentions: list[Mention] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    caution: Decision
    related_articles: list[RelatedArticle] = Field(default_factory=list)
    headline_difference: str
    final_comment: str
    search_status: SearchStatus
    search_errors: list[str] = Field(default_factory=list)
    analyzed_at: str
    event: EventInfo = Field(default_factory=EventInfo)
    article_context: ArticleContext = Field(default_factory=ArticleContext)
    section_states: dict[str, SectionState] = Field(default_factory=dict)
    pipeline_errors: list[PipelineError] = Field(default_factory=list)

    @model_validator(mode='after')
    def references_exist(self):
        source_ids = {s.id for s in self.sources}
        mention_ids = {m.id for m in self.evidence_mentions}
        claim_ids = {c.id for c in self.claims}
        if any(not set(c.source_ids) <= source_ids or not set(c.mention_ids) <= mention_ids for c in self.claims):
            raise ValueError('Unknown claim reference')
        if any(not set(m.claim_ids) <= claim_ids for m in self.evidence_mentions):
            raise ValueError('Unknown mention claim')
        if any(not set(s.mention_ids) <= mention_ids for s in self.sources):
            raise ValueError('Unknown source mention')
        if any(not set(t.source_ids) <= source_ids for t in self.context_timeline):
            raise ValueError('Unknown timeline source')
        report_ids = [r.id for r in self.related_articles if r.id]
        if len(set(report_ids)) != len(report_ids):
            raise ValueError('Duplicate related report ID')
        for decision in [self.caution, *[c.caution for c in self.claims], *[s.caution for s in self.sources]]:
            if any(not set(d.source_ids) <= source_ids or not set(d.claim_ids) <= claim_ids for d in decision.details):
                raise ValueError('Unknown caution reference')
        return self


class AnalyzeRequest(Model):
    url: HttpUrl
    title: str = Field(default='', max_length=500)
    page_text: str = Field(default='', max_length=60000)
    metadata: Article | None = None
    refresh: bool = False
    article_context: ArticleContext = Field(default_factory=ArticleContext)


class SelectionRequest(AnalyzeRequest):
    article_id: str | None = None
    selected_text: str = Field(min_length=2, max_length=3000)
    surrounding_text: str = Field(default='', max_length=6000)


class SelectionAnalysis(Model):
    article_id: str
    selected_text: str
    is_demo: bool
    claims: list[Claim]
    sources: list[Source]
    caution: Decision
    pipeline_errors: list[PipelineError] = Field(default_factory=list)
    analysis_id: str | None = None
    matched_claim_ids: list[str] = Field(default_factory=list)
    evidence_mentions: list[Mention] = Field(default_factory=list)


class Preview(Model):
    article_id: str
    is_demo: bool
    summary: str
    major_evidence: list[Mention]
    sources: list[Source]
    headline_difference: str
    one_line_caution: str
    search_status: SearchStatus
    claims: list[Claim] = Field(default_factory=list)
    body_hash: str = ''
    data_version: str = 'source-tracing-v1.3'
    pipeline_errors: list[PipelineError] = Field(default_factory=list)


class Extraction(Model):
    summary: str
    claims: list[Claim] = Field(max_length=3)
    evidence_mentions: list[Mention]
    context_timeline: list[TimelineItem] = Field(default_factory=list)
    headline_difference: str
    event: EventInfo = Field(default_factory=EventInfo)


class SourceReview(Model):
    source_id: str
    mention_ids: list[str]
    original_status: Literal['original_found', 'secondary_only', 'unknown']
    facts: SourceFacts


class SourceReviews(Model):
    sources: list[SourceReview]
