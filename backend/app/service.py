import asyncio
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from .models import (Article, ArticleAnalysis, Claim, Decision, Extraction, Source, RelatedArticle,
                     SourceFacts, SourceReviews, AnalyzeRequest, SelectionAnalysis)
from .prompts import EXTRACT, TRACE


class ArticleInputError(ValueError):
    """Invalid user article input, distinct from provider/schema failures."""


def normalize_url(url):
    p = urlsplit(str(url))
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('HTTP(S) URL이 필요합니다.')
    query = sorted((k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith('utm_') and k != 'fbclid')
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or '/', urlencode(query), ''))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def body_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


def combine_decisions(decisions):
    status = 'caution' if any(d.status == 'caution' for d in decisions) else 'unknown' if not decisions or any(d.status == 'unknown' for d in decisions) else 'none_identified'
    reasons = list(dict.fromkeys(r for d in decisions for r in d.reasons))
    return Decision(status=status, reasons=reasons or ['출처 분석에 필요한 정보가 부족합니다.'])


FACT_LABELS = {'identity': '작성기관', 'originality': '원자료 관계', 'expertise': '전문 분야',
    'information_access': '자료 접근 경로', 'date_context': '작성 시점', 'public_access': '공개 범위',
    'methodology': '조사 방법', 'interests': '이해관계', 'independence': '자료 독립성'}


def source_decision(status, facts, kind, published_at=None, reference_date=None):
    reasons = []
    if status == 'secondary_only':
        reasons.append('재인용 관계만 확인되어 원본 자료를 직접 확인하지 못했습니다.')
    if kind in ('statistics', 'research', '통계', '연구') and not facts.methodology:
        reasons.append('확보한 자료에서 조사·연구 방법을 확인하지 못했습니다.')
    if facts.interests and not re.search(r'이해관계\s*없|no conflicts? of interest', facts.interests.excerpt, re.I):
        reasons.append('자료 작성자의 이해관계 관련 문구를 확인했습니다: ' + facts.interests.excerpt)
    if published_at and reference_date:
        try:
            age = (datetime.fromisoformat(reference_date[:10]) - datetime.fromisoformat(published_at[:10])).days
            if age > 365:
                reasons.append(f'자료 발행일은 기사 작성일보다 {age}일 이전입니다. 최신 자료가 필요한지는 별도로 확인해 주세요.')
        except (ValueError, TypeError):
            pass
    missing = [FACT_LABELS[k] for k, v in facts.model_dump().items() if v is None]
    for label, value in [('자료 발행일', published_at), ('기사 작성일', reference_date)]:
        try:
            if not value:
                raise ValueError('missing date')
            datetime.fromisoformat(value[:10])
        except (ValueError, TypeError):
            missing.append(label)
    if reasons:
        return Decision(status='caution', reasons=reasons), missing
    if status != 'original_found' or missing:
        return Decision(status='unknown', reasons=['출처 속성을 확인하지 못했습니다: ' + ', '.join(missing)] if missing else ['원본 여부를 확인하지 못했습니다.']), missing
    return Decision(status='none_identified', reasons=['확보한 출처 정보에서 별도의 주의사항을 발견하지 못했습니다. 주장 진위의 판정은 아닙니다.']), missing


def claim_decision(claim, mentions, sources, search_status):
    reasons = []
    if claim.claim_type in ('opinion', 'interpretation', 'prediction'):
        reasons.append('의견·해석·예측에 해당하는 문장입니다. 사건의 발생 여부와 구분해 읽어야 합니다.')
    if not mentions or all(not m.source_label for m in mentions):
        reasons.append('이 주장에 연결된 근거의 출처가 기사에 명확히 제시되지 않았습니다.')
    if any(m.anonymous for m in mentions):
        reasons.append('익명 관계자 등의 발언으로 원출처를 추적하기 어렵습니다.')
    if claim.source_status == 'source_not_found':
        reasons.append('완료된 검색 범위에서 기사에 언급된 원출처를 찾지 못했습니다. 정보가 잘못되었다는 뜻은 아닙니다.')
    if claim.source_status == 'secondary_only':
        reasons.append('원자료를 직접 확인하지 못했고 재인용 자료만 찾았습니다.')
    decisions = [s.caution for s in sources]
    if reasons:
        decisions.append(Decision(status='caution', reasons=reasons))
    if search_status != 'completed' or claim.source_status == 'unknown':
        decisions.append(Decision(status='unknown', reasons=['검색 실패 또는 출처 관계 정보 부족으로 분석이 불완전합니다.']))
    return combine_decisions(decisions)


class Analyzer:
    def __init__(self, llm, search, mode='live', ttl=900):
        self.llm, self.search, self.mode, self.ttl = llm, search, mode, ttl
        self.cache, self.inflight = {}, {}

    def cache_key(self, request, focus=None):
        # Metadata/title are included so corrections cannot reuse an old presentation.
        return body_hash(json.dumps([normalize_url(request.url), body_hash(request.page_text),
            request.title, request.metadata.model_dump(mode='json') if request.metadata else None,
            self.mode, os.getenv('LLM_MODEL'), 'source-tracing-v1', focus], ensure_ascii=False))

    async def analyze(self, request, focus=None):
        if not request.page_text.strip():
            raise ArticleInputError('기사 본문을 확보하지 못했습니다. 제목만으로 요약하지 않습니다.')
        try:
            key = self.cache_key(request, focus)
        except ValueError as exc:
            raise ArticleInputError('사용자 정보가 없는 HTTP(S) 기사 URL이 필요합니다.') from exc
        cached = self.cache.get(key)
        if not request.refresh and cached and cached[0] > time.monotonic():
            return cached[1].model_copy(deep=True)
        if key not in self.inflight:
            self.inflight[key] = asyncio.create_task(self._run(request, key, focus))
        task = self.inflight[key]
        try:
            result = await asyncio.shield(task)
            if result.search_status == 'completed' and not result.search_errors:
                if len(self.cache) >= 128:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (time.monotonic() + self.ttl, result)
            return result.model_copy(deep=True)
        finally:
            if task.done():
                self.inflight.pop(key, None)

    async def _run(self, request, key, focus=None):
        if self.mode == 'mock':
            path = Path(__file__).resolve().parents[2] / 'newscheck 4/data/demo.json'
            # Fixed fixture is never passed off as analysis of the requested real article.
            return ArticleAnalysis.model_validate_json(path.read_text(encoding='utf-8'))
        instruction = EXTRACT
        if focus:
            instruction += '\nselected_text에 해당하는 주장만 추출하라. 발언자와 기사 근거를 이해할 때 body의 주변 문맥을 참고하라.'
        extracted = await self.llm.generate(instruction, {'title': request.title, 'body': request.page_text, 'selected_text': focus}, Extraction)
        extracted = self.clean_extraction(extracted, request.page_text)
        if focus:
            extracted.claims = [c for c in extracted.claims if focus in c.original_text or c.original_text in focus]
            ids = {c.id for c in extracted.claims}
            for mention in extracted.evidence_mentions:
                mention.claim_ids = [i for i in mention.claim_ids if i in ids]
            extracted.evidence_mentions = [m for m in extracted.evidence_mentions if m.claim_ids]
        claims, mentions = extracted.claims, extracted.evidence_mentions
        candidates, search_errors = {}, []
        queries = list(dict.fromkeys(' '.join(filter(None, [m.source_label, m.document_title, m.article_quote[:120]])) for m in mentions))[:3]
        for query in queries:
            try:
                rows = await self.search.search(query)
            except Exception:
                search_errors.append('원출처 검색 요청이 실패했습니다. 다시 시도할 수 있습니다.')
                continue
            for row in rows:
                try:
                    url = normalize_url(row['url'])
                except (ValueError, KeyError, TypeError):
                    continue
                if url == normalize_url(request.url):
                    continue
                content = row.get('raw_content') or ''
                candidate = {'id': 'src_' + body_hash(url)[:16], 'url': url,
                    'title': str(row.get('title') or ''), 'content': str(content)[:16000],
                    'snippet': str(row.get('content') or '')[:2000],
                    'published_at': row.get('published_date') if isinstance(row.get('published_date'), str) else None, 'retrieved_at': now_iso()}
                # Search snippets are discovery hints, not full primary-source observations.
                if url not in candidates or len(candidate['content']) > len(candidates[url]['content']):
                    candidates[url] = candidate
        search_status = 'failed' if search_errors else 'completed' if queries else 'not_run'
        reviews = SourceReviews(sources=[])
        if candidates:
            try:
                reviews = await self.llm.generate(TRACE, {'mentions': [m.model_dump() for m in mentions],
                    'sources': list(candidates.values())}, SourceReviews)
            except Exception:
                search_errors.append('출처 속성 정리를 완료하지 못했습니다. 원본 여부를 보류합니다.')
        sources = self.build_sources(mentions, list(candidates.values()), reviews,
            request.metadata.published_at if request.metadata else None)
        for claim in claims:
            own_mentions = [m for m in mentions if claim.id in m.claim_ids]
            claim.mention_ids = [m.id for m in own_mentions]
            own_sources = [s for s in sources if set(s.mention_ids) & set(claim.mention_ids)]
            claim.source_ids = [s.id for s in own_sources]
            if any(s.original_status == 'original_found' for s in own_sources):
                claim.source_status = 'original_found'
            elif search_status == 'failed':
                claim.source_status = 'unknown'
            elif any(s.original_status == 'secondary_only' for s in own_sources):
                claim.source_status = 'secondary_only'
            elif own_sources or search_errors or not own_mentions:
                claim.source_status = 'unknown'
            else:
                claim.source_status = 'source_not_found' if search_status == 'completed' else 'unknown'
            claim.caution = claim_decision(claim, own_mentions, own_sources, search_status)
        decision = combine_decisions([c.caution for c in claims])
        if search_errors:
            decision = combine_decisions([decision, Decision(status='unknown', reasons=search_errors)])
        related = []
        if request.title and not focus:
            try:
                rows = await self.search.search(request.title[:200], topic='news')
                hosts = set()
                for row in rows:
                    try:
                        url = normalize_url(row['url'])
                    except (KeyError, TypeError, ValueError):
                        continue
                    host = urlsplit(url).hostname
                    if host in hosts or url == normalize_url(request.url):
                        continue
                    hosts.add(host)
                    related.append(RelatedArticle(url=url, title=str(row.get('title') or ''),
                        publisher=None, published_at=row.get('published_date'),
                        differences_summary='검색 결과 요약(기사 본문 비교 전): ' + str(row.get('content') or '내용 차이 미확인')[:250]))
                    if len(related) == 3:
                        break
            except Exception:
                search_errors.append('관련 기사 검색이 실패했습니다. 원출처 검색 상태와는 별개입니다.')
        metadata = request.metadata or Article(url=request.url, title=request.title)
        metadata = metadata.model_copy(update={'url': request.url, 'title': request.title or metadata.title})
        return ArticleAnalysis(article_id=key[:24], body_hash=body_hash(request.page_text),
            analysis_status='partial' if search_errors or decision.status == 'unknown' or any(s.unknown_fields for s in sources) else 'complete',
            article=metadata, one_line_summary=extracted.summary, claims=claims, evidence_mentions=mentions,
            context_timeline=extracted.context_timeline, sources=sources, caution=decision, related_articles=related,
            headline_difference=extracted.headline_difference, search_status=search_status, search_errors=search_errors,
            final_comment='기사의 근거와 원출처를 추적한 결과입니다. 출처 확인이나 주의사항 부재는 주장 진실성의 입증이 아닙니다.', analyzed_at=now_iso())

    @staticmethod
    def clean_extraction(extracted, text):
        # Reject hallucinated quotations, speakers and article-attributed sources.
        claims, seen = [], set()
        for c in extracted.claims:
            if c.id in seen or not c.original_text or c.original_text not in text:
                continue
            seen.add(c.id)
            c.claim_text = c.original_text
            c.speaker = c.speaker if c.speaker and c.speaker in text else None
            c.source_ids, c.mention_ids, c.source_status = [], [], 'unknown'
            c.caution = Decision(reasons=['출처 분석 전입니다.'])
            claims.append(c)
        ids = {c.id for c in claims}
        mentions, seen = [], set()
        for m in extracted.evidence_mentions:
            if m.id in seen or not m.article_quote or m.article_quote not in text:
                continue
            seen.add(m.id)
            m.claim_ids = [i for i in m.claim_ids if i in ids]
            m.description = m.article_quote
            m.source_label = m.source_label if m.source_label and m.source_label in m.article_quote else None
            m.document_title = m.document_title if m.document_title and m.document_title in text else None
            m.anonymous = bool(re.search(r'익명|관계자|소식통', m.article_quote))
            mentions.append(m)
        extracted.claims, extracted.evidence_mentions = claims, mentions
        extracted.context_timeline = [t.model_copy(update={'description': t.article_quote}) for t in extracted.context_timeline if t.article_quote and t.article_quote in text]
        return extracted

    @staticmethod
    def build_sources(mentions, candidates, reviews, reference_date=None):
        allowed_mentions = {m.id: m for m in mentions}
        # Duplicate reviews are not allowed to overwrite an earlier observation.
        by_id = {}
        for r in reviews.sources:
            if r.source_id not in by_id:
                by_id[r.source_id] = r
        sources = []
        for c in candidates:
            review = by_id.get(c['id'])
            facts = SourceFacts()
            mids, status = [], 'unknown'
            if review:
                facts = SourceFacts(**{k: v for k, v in review.facts.model_dump().items()
                    if v and v['excerpt'] in c['content']})
                for mid in review.mention_ids:
                    mention = allowed_mentions.get(mid)
                    if not mention:
                        continue
                    # A subject match alone does not establish an article citation.
                    if mention.document_title:
                        if mention.document_title in (c['title'] + c['content']):
                            mids.append(mid)
                    elif mention.source_label and facts.identity and mention.source_label in facts.identity.excerpt and mention.article_quote in c['content']:
                        mids.append(mid)
                if mids and facts.originality:
                    status = review.original_status
                    if status == 'original_found' and not facts.identity:
                        status = 'unknown'
            decision, missing = source_decision(status, facts, next((allowed_mentions[i].source_kind for i in mids), 'unknown'), c['published_at'], reference_date)
            sources.append(Source(id=c['id'], url=c['url'], title=c['title'],
                publisher=facts.identity.excerpt if facts.identity else None,
                published_at=c['published_at'], retrieved_at=c['retrieved_at'],
                discovery='article_cited' if mids else 'external_found', mention_ids=list(dict.fromkeys(mids)),
                source_kind=next((allowed_mentions[i].source_kind for i in mids), 'unknown'), original_status=status,
                facts=facts, unknown_fields=missing, summary=('작성기관 표기: ' + facts.identity.excerpt + '. ' if facts.identity else '작성기관 표기를 확인하지 못했습니다. ')
                    + ('추가 확인 항목: ' + ', '.join(missing) if missing else '공개된 출처 속성을 정리했습니다. 주장 진위의 판정은 아닙니다.'), caution=decision))
        return sources

    async def selection(self, request):
        if request.selected_text not in request.page_text:
            raise ArticleInputError('선택 문장이 전달된 기사 본문에 없습니다.')
        analysis = await self.analyze(AnalyzeRequest(**request.model_dump(exclude={'article_id', 'selected_text', 'surrounding_text'})))
        if request.article_id and request.article_id != analysis.article_id:
            raise ArticleInputError('현재 기사와 분석 ID가 다릅니다. 기사를 다시 분석해 주세요.')
        matches = [c for c in analysis.claims if request.selected_text in c.original_text or c.original_text in request.selected_text]
        if not matches and not analysis.is_demo:
            # A new selection is traced separately, preserving whole-article cached output.
            local = await self.analyze(AnalyzeRequest(url=request.url, title=request.title,
                page_text=request.page_text, metadata=request.metadata), focus=request.selected_text)
            matches, analysis_sources = local.claims, local.sources
        else:
            analysis_sources = analysis.sources
        source_ids = {i for c in matches for i in c.source_ids}
        return SelectionAnalysis(article_id=analysis.article_id, selected_text=request.selected_text, is_demo=analysis.is_demo,
            claims=matches, sources=[s for s in analysis_sources if s.id in source_ids],
            caution=combine_decisions([c.caution for c in matches]))
