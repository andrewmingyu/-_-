"""Source tracing contract. No claim truth, probability or entailment fields."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

SourceStatus = Literal['original_found', 'secondary_only', 'source_not_found', 'unknown']
CautionStatus = Literal['caution', 'none_identified', 'unknown']
ClaimType = Literal['factual_narration', 'quotation', 'opinion', 'interpretation', 'prediction', 'context', 'statistics', 'unknown']
SearchStatus = Literal['completed', 'failed', 'not_run']


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Decision(Model):
    status: CautionStatus = 'unknown'
    reasons: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)


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


class Observation(Model):
    # A literal passage from the retrieved document, not a model reputation judgment.
    excerpt: str = Field(min_length=1, max_length=1200)


class SourceFacts(Model):
    identity: Observation | None = None
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


class TimelineItem(Model):
    date: str
    description: str
    article_quote: str


class RelatedArticle(Model):
    url: HttpUrl
    title: str
    publisher: str | None = None
    published_at: str | None = None
    differences_summary: str
    independence: str = '독립적인 자료에 기반했는지 확인하지 못했습니다.'


class ArticleAnalysis(Model):
    schema_version: Literal['source-tracing-v1'] = 'source-tracing-v1'
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
        return self


class AnalyzeRequest(Model):
    url: HttpUrl
    title: str = Field(default='', max_length=500)
    page_text: str = Field(default='', max_length=60000)
    metadata: Article | None = None
    refresh: bool = False


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


class Preview(Model):
    article_id: str
    is_demo: bool
    summary: str
    major_evidence: list[Mention]
    sources: list[Source]
    headline_difference: str
    one_line_caution: str
    search_status: SearchStatus


class Extraction(Model):
    summary: str
    claims: list[Claim] = Field(max_length=3)
    evidence_mentions: list[Mention]
    context_timeline: list[TimelineItem] = Field(default_factory=list)
    headline_difference: str


class SourceReview(Model):
    source_id: str
    mention_ids: list[str]
    original_status: Literal['original_found', 'secondary_only', 'unknown']
    facts: SourceFacts


class SourceReviews(Model):
    sources: list[SourceReview]
