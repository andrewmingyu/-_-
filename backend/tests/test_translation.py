from app.models import Extraction
from app.service import Analyzer

EN = 'Kim seeks to weaken sanctions by offering a moratorium on missile tests.'
EN2 = 'He met Kim Jong-il in 2007.'
EN_TEXT = EN + ' ' + EN2
KO = '연구원은 지원제도 개편을 검토한다고 밝혔다.'


def make(original, quote, claim_tr, mention_tr):
    return Extraction(summary='요약', headline_difference='차이',
        claims=[{'id':'c1','original_text':original,'claim_text':original,'translation':claim_tr,'claim_type':'quotation'}],
        evidence_mentions=[{'id':'m1','claim_ids':['c1'],'description':quote,'article_quote':quote,'translation':mention_tr}])


def test_foreign_article_keeps_original_quote_and_korean_translation():
    clean = Analyzer.clean_extraction(make(EN, EN2, '김정은은 미사일 시험 유예를 내세워 제재를 약화하려 한다.', '그는 2007년 김정일을 만났다.'), EN_TEXT)
    claim, mention = clean.claims[0], clean.evidence_mentions[0]
    # 원문 인용은 그대로 (본문에서 보기·검증용)
    assert claim.claim_text == EN and claim.original_text == EN
    assert mention.description == EN2 and mention.article_quote == EN2
    # 번역은 별도 칸에 유지
    assert claim.translation.startswith('김정은은') and mention.translation.startswith('그는')


def test_korean_article_and_non_korean_translation_are_dropped():
    ko = Analyzer.clean_extraction(make(KO, KO, '다른 번역 문장입니다.', '다른 번역입니다.'), KO)
    assert ko.claims[0].translation is None and ko.evidence_mentions[0].translation is None
    en = Analyzer.clean_extraction(make(EN, EN2, EN, 'He met Kim.'), EN_TEXT)
    assert en.claims[0].translation is None and en.evidence_mentions[0].translation is None
