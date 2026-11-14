import asyncio
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.models import ArticleAnalysis, AnalyzeRequest, Extraction
from app.service import Analyzer

FIRST = '연구원은 지원제도 개편을 검토한다고 밝혔다.'
SECOND = '세부 일정은 아직 정해지지 않았다고 설명했다.'
TEXT = FIRST + ' ' + SECOND


def extraction(**extra):
    return Extraction(summary=FIRST,headline_difference='검토 단계',
        claims=[{'id':'c1','original_text':FIRST,'claim_text':FIRST,'claim_type':'quotation'}],
        evidence_mentions=[{'id':'m1','claim_ids':['c1'],'description':FIRST,'article_quote':FIRST}],
        **extra)


def test_headline_reasons_are_grounded_and_unissued_ids_are_removed():
    raw = extraction(headline_explanation={'meaning':'지원제도 개편을 검토하는 상황입니다.','reasons':[
        {'text':'연구원이 개편 검토를 설명했습니다.','article_quote':FIRST,
         'claim_ids':['invented'],'mention_ids':['invented'],'source_ids':['invented']},
        {'text':'확정했습니다.','article_quote':'원문에 없는 문장입니다.'}]})
    clean = Analyzer.clean_extraction(raw,TEXT)
    assert len(clean.headline_explanation.reasons) == 1
    reason = clean.headline_explanation.reasons[0]
    assert reason.claim_ids == ['c1'] and reason.mention_ids == ['m1']
    assert reason.source_ids == []
    assert TEXT[reason.article_span.start:reason.article_span.end] == FIRST


def test_headline_meaning_is_not_kept_without_grounded_reasons():
    raw = extraction(headline_explanation={'meaning':'없는 이유를 설명합니다.','reasons':[
        {'text':'없는 사실을 근거로 합니다.','article_quote':'존재하지 않음'}]})
    clean = Analyzer.clean_extraction(raw,TEXT)
    assert clean.headline_explanation.meaning == ''
    assert clean.headline_explanation.reasons == []


def test_timeline_preserves_short_labels_and_selects_one_actual_main_event():
    before = '지난해에는 기존 지원제도를 운영했다.'
    raw = extraction(event={'label':'지원제도 개편 검토','description':FIRST,'article_quote':FIRST},
        context_timeline=[
            {'date':'지난해','label':'기존 지원제도 운영','is_main_event':True,'description':before,'article_quote':before},
            {'date':'2026년','label':'개편 검토','is_main_event':True,'description':FIRST,'article_quote':FIRST},
            {'date':'시점 미확인','label':'세부 일정 미정','is_main_event':True,'description':SECOND,'article_quote':SECOND},
            {'date':'어제','label':'가짜 배경','is_main_event':True,'description':'없는 사건','article_quote':'없는 사건'}])
    clean = Analyzer.clean_extraction(raw,before+' '+TEXT)
    assert [t.label for t in clean.context_timeline] == ['기존 지원제도 운영','개편 검토','세부 일정 미정']
    assert [t.is_main_event for t in clean.context_timeline] == [False,True,False]
    assert clean.context_timeline[1].date == '시점 미확인'
    assert clean.context_timeline[1].description == FIRST


def test_mock_uses_the_existing_pipeline_for_reasons_and_selection_keeps_parent_cache():
    analyzer = Analyzer(None,None,mode='mock')
    request = AnalyzeRequest(url='https://news.example/article/1',title='지원제도 개편 검토',page_text=TEXT)
    full = asyncio.run(analyzer.analyze(request))
    assert full.headline_explanation.reasons
    assert all(r.article_quote in TEXT for r in full.headline_explanation.reasons)
    focused = asyncio.run(analyzer.analyze(request,focus=SECOND))
    assert focused.headline_explanation.reasons == []
    assert analyzer.lookup(full.article_id).headline_explanation == full.headline_explanation


def test_api_contract_rejects_unknown_headline_references_and_long_box_labels():
    root = Path(__file__).resolve().parents[2]
    data = json.loads((root/'newscheck 4/data/demo.json').read_text(encoding='utf-8'))
    ArticleAnalysis.model_validate(data)
    data['headline_explanation']['reasons'][0]['source_ids'] = ['invented']
    with pytest.raises(ValidationError,match='headline reason reference'):
        ArticleAnalysis.model_validate(data)
    with pytest.raises(ValidationError):
        extraction(context_timeline=[{'date':'미확인','label':'길'*25,'description':FIRST,'article_quote':FIRST}])
