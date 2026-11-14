import pytest
from pydantic import ValidationError
from app.models import RelatedArticle
from app.report_comparison import apply_comparisons
from app import main
from app.models import ArticleContext,ArticleLink
from app.service import Analyzer
from fastapi.testclient import TestClient
from test_report_comparison import ComparisonLLM,NewsSearch
from test_sources import TEXT,request

CURRENT='2027년 지원금은 올해보다 확대할 계획이라고 발표했다.'
OTHER='2027년 지원금은 올해보다 축소할 계획이라고 발표했다.'
ANCHOR='2027년 지원금'
def compare(*,basis='body_excerpt',kind='claim_conflict',cited=False,anchor=ANCHOR,article=CURRENT,other=OTHER):
    report=RelatedArticle(id='report_1',url='https://other.example/report',title='비교 보도',differences_summary='',comparison_basis=basis)
    output={'reports':[{'report_id':report.id,'points':[{'kind':'difference','aspect':'figures',
        'article_quote':CURRENT,'related_quote':OTHER,'review_kind':kind,'context_anchor':anchor}]}]}
    apply_comparisons([report],{report.id:other},article,output,cited_report_ids={report.id} if cited else set())
    return report

def test_cross_report_attention_requires_exact_paired_excerpts_and_a_shared_reference():
    report=compare();point=report.comparison_points[0]
    assert point.review_status=='paired_excerpt' and point.context_anchor==ANCHOR
    assert point.review_kind=='claim_conflict'
    assert compare(article='원문에 해당 문장이 없습니다.').comparison_status=='insufficient'
    assert compare(other='다른 기사에 해당 문장이 없습니다.').comparison_status=='insufficient'

@pytest.mark.parametrize('basis',['search_snippet','title_only'])
def test_search_and_title_comparisons_remain_unconfirmed_candidates(basis):
    assert compare(basis=basis).comparison_points[0].review_status=='needs_confirmation'

def test_missing_or_fabricated_reference_does_not_become_red():
    assert compare(anchor='').comparison_points[0].review_status=='needs_confirmation'
    assert compare(anchor='다른 사안').comparison_points[0].review_status=='needs_confirmation'

def test_citation_wording_alert_requires_server_verified_citation_relation():
    not_cited=compare(kind='citation_difference')
    assert not_cited.comparison_points[0].review_kind=='none'
    cited=compare(kind='citation_difference',cited=True)
    assert cited.cited_by_article and cited.comparison_points[0].review_status=='paired_excerpt'
    assert '왜곡했습니다' not in cited.model_dump_json()

def test_focus_differences_do_not_get_promoted_and_original_report_ids_are_checked():
    report=RelatedArticle(id='r',url='https://other.example',title='다른 보도',differences_summary='',comparison_basis='body_excerpt')
    output={'reports':[{'report_id':'r','points':[{'kind':'difference','aspect':'focus','article_quote':CURRENT,
        'related_quote':OTHER,'review_kind':'claim_conflict','context_anchor':ANCHOR}]}]}
    apply_comparisons([report],{'r':OTHER},CURRENT,output)
    assert report.comparison_points[0].review_kind=='none'
    output['reports'][0]['report_id']='invented'
    apply_comparisons([report],{'r':OTHER},CURRENT,output)
    assert not report.comparison_points

def test_public_contract_rejects_red_from_snippets_or_unlinked_citation_sources():
    report=compare().model_dump()
    report['comparison_basis']='search_snippet'
    with pytest.raises(ValidationError):RelatedArticle.model_validate(report)
    report=compare(kind='citation_difference',cited=True).model_dump();report['cited_by_article']=False
    with pytest.raises(ValidationError):RelatedArticle.model_validate(report)

@pytest.mark.parametrize('cited',[False,True])
def test_full_api_preserves_paired_review_and_verifies_source_relation(monkeypatch,cited):
    kind='citation_difference' if cited else 'claim_conflict'
    def transform(output,payload):
        output['reports'][0]['points']=[{'kind':'difference','aspect':'figures','article_quote':CURRENT,
            'related_quote':OTHER,'review_kind':kind,'context_anchor':ANCHOR}]
        return output
    search=NewsSearch();search.news[0]['raw_content']=OTHER
    analyzer=Analyzer(ComparisonLLM(transform),search);monkeypatch.setattr(main,'analyzer',analyzer)
    req=request().model_copy(update={'page_text':TEXT+' '+CURRENT})
    if cited:req.article_context=ArticleContext(cited_links=[ArticleLink(url=search.news[0]['url'],text=ANCHOR,article_quote=CURRENT)])
    with TestClient(main.app) as client:
        response=client.post('/api/articles/analyze',json=req.model_dump(mode='json'))
        assert response.status_code==200
        data=response.json();report=data['related_articles'][0]
        assert report['comparison_points'][0]['review_status']=='paired_excerpt'
        assert report['cited_by_article']==cited
        assert report['comparison_points'][0]['review_kind']==kind
        assert data['claims'][0]['source_status']=='original_found'
