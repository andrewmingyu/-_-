"""Deterministic demo providers. They run through the SAME pipeline and never call the network."""
import json
import re
from pathlib import Path
from .models import Claim, EventInfo, Extraction, SourceReviews, TimelineItem, ReportComparisons, HeadlineExplanation

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / 'fixtures/mock_source_documents.json').read_text(encoding='utf-8'))

class MockLLM:
    async def generate(self, instruction, payload, schema):
        if schema is ReportComparisons:
            reports = []
            for report in payload['reports']:
                points = []
                phrase = '지원제도 개편을 검토 중'
                if phrase in payload['body'] and phrase in report['text']:
                    points.append({'kind':'common','aspect':'topic','article_quote':phrase,'related_quote':phrase})
                current = '지원 규모와 시행 시점은 아직 정해지지 않았다고 적었다.'
                other = '시행 시점은 미정이며 검토 일정에 초점을 맞춘 시연 보도다.'
                if current in payload['body'] and other in report['text']:
                    points.append({'kind':'difference','aspect':'focus','article_quote':current,'related_quote':other})
                reports.append({'report_id':report['id'],'points':points})
            return ReportComparisons(reports=reports)
        if schema is Extraction:
            text = payload['body']
            focus = payload.get('selected_text')
            sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', text) if s.strip()]
            selected = [focus] if focus else sentences[:3]
            claims, mentions = [], []
            for i, sentence in enumerate(selected):
                cid = f'claim_{i+1}'
                kind = 'prediction' if re.search(r'가능성|전망|예정|수 있다', sentence) else 'quotation' if re.search(r'[“「\"]|밝혔|말했|발표', sentence) else 'factual_narration'
                org = re.search(r'([가-힣A-Za-z]+(?:연구소|연구원|기관|위원회|관계자))', sentence)
                speaker = org.group(1) if org else None
                claims.append(Claim(id=cid, original_text=sentence, claim_text=sentence, claim_type=kind, speaker=speaker))
                title = re.search(r'「([^」]+)」', sentence)
                if speaker or title or re.search(r'자료|통계|조사|인터뷰', sentence):
                    mentions.append({'id':f'mention_{i+1}', 'claim_ids':[cid], 'description':sentence,
                        'article_quote':sentence, 'source_label':speaker, 'document_title':title.group(1) if title else None,
                        'source_kind':'anonymous_statement' if '관계자' in sentence else 'official_release' if title else 'unknown'})
            event = EventInfo()
            timeline = []
            for sentence in sentences:
                match = re.search(r'(20\d{2}년\s*\d{1,2}월\s*\d{1,2}일)\s+([가-힣]{2,12})에서', sentence)
                if match:
                    event = EventInfo(label='주요 사건',description=sentence, article_quote=sentence, time=match.group(1), location=match.group(2))
                    timeline = [TimelineItem(date=match.group(1),label='주요 사건',is_main_event=True,description=sentence,article_quote=sentence)]
                    break
            explanation = HeadlineExplanation() if focus else HeadlineExplanation(
                meaning=' '.join(selected[:2])[:600],
                reasons=[{'text':c.original_text if len(c.original_text)<=240 else '기사에서 제목과 관련된 내용을 설명합니다.','article_quote':c.original_text[:2000],'claim_ids':[c.id],
                          'mention_ids':[m['id'] for m in mentions if c.id in m['claim_ids']]} for c in claims[:3]])
            return Extraction(summary='\n'.join(selected[:2]),
                headline_explanation=explanation,
                claims=claims,evidence_mentions=mentions,context_timeline=timeline,event=event,
                headline_difference='시연 모드에서는 제목과 본문 표현의 차이를 자동 평가하지 않습니다.')
        reviews = []
        for source in payload['sources']:
            if source['url'] != FIXTURE['source']['url']:
                continue
            mids = [m['id'] for m in payload['mentions'] if m.get('document_title') == FIXTURE['source']['title']]
            reviews.append({'source_id':source['id'],'mention_ids':mids,'original_status':'original_found',
                'facts':{k:{'excerpt':v} for k,v in FIXTURE['facts'].items()}})
        return SourceReviews(sources=reviews)

class MockSearch:
    async def search(self, query, topic='general'):
        if topic == 'news':
            return FIXTURE['related'] if '지원제도' in query else []
        source = FIXTURE['source']
        return [{'url':source['url'],'title':source['title'],'raw_content':source['content'],
                 'content':'시연용 원자료 검색 결과','published_date':source['published_date']}] if source['title'] in query or source['url'] in query else []

    async def extract(self, urls):
        source = FIXTURE['source']
        return [{'url':source['url'],'raw_content':source['content']}] if source['url'] in urls else []
