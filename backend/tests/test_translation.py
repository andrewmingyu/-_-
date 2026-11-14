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


def test_dates_are_kept_when_their_numbers_appear_in_the_original():
    from app.service import grounded_date
    assert grounded_date('2007년', 'He met Kim Jong-il in 2007.')
    assert grounded_date('3월 12일', 'On March 12, 2018 the talks began.')
    assert not grounded_date('2006년', 'in 2007')            # 숫자가 다르면 추정으로 보고 막음
    assert not grounded_date('신년', 'his new year message')   # 숫자 없는 날짜는 원문 그대로일 때만
    assert not grounded_date('5월', 'lives May be lost')       # 일반 단어 may를 달로 읽지 않음
    assert not grounded_date('시점 미확인', 'anything')


def test_source_label_after_an_english_quote_is_kept():
    text = '"Kim seeks to weaken sanctions," says Prof Lee Sung-yoon from the Fletcher School.'
    quote = 'Kim seeks to weaken sanctions'
    raw = Extraction(summary='요약', headline_difference='차이',
        claims=[{'id':'c1','original_text':quote,'claim_text':quote,'claim_type':'quotation'}],
        evidence_mentions=[{'id':'m1','claim_ids':['c1'],'description':quote,'article_quote':quote,'source_label':'Prof Lee Sung-yoon'},
                           {'id':'m2','claim_ids':['c1'],'description':quote,'article_quote':quote,'source_label':'Moon Jae-in'}])
    clean = Analyzer.clean_extraction(raw, text)
    assert clean.evidence_mentions[0].source_label == 'Prof Lee Sung-yoon'   # 인용 바로 뒤의 발언자는 인정
    assert clean.evidence_mentions[1].source_label is None                     # 문장에 없는 이름은 여전히 제거


def test_timeline_uses_the_date_written_in_the_quote_when_ai_adds_month():
    # 연합뉴스 사례: 원문은 '8일(현지시간)', '9일'인데 AI가 '11월 8일'처럼 원문에 없는 달을 붙인 경우
    first = '엔비디아 이사회는 8일(현지시간) 독립 조사에 착수했다고 발표했다.'
    second = '궈자쿤 중국 외교부 대변인은 9일 브리핑에서 순전히 실체 없는 것이라고 답했다.'
    third = '그는 동일한 답변을 내놨다.'
    raw = Extraction(summary='요약', headline_difference='차이',
        claims=[{'id':'c1','original_text':second,'claim_text':second,'claim_type':'quotation'}],
        evidence_mentions=[],
        context_timeline=[{'date':'11월 8일','label':'이사회 독립조사 착수','description':first,'article_quote':first},
                          {'date':'2026-11-09','label':'중국 외교부 입장 표명','description':second,'article_quote':second},
                          {'date':'11월 9일','label':'동일 답변','description':third,'article_quote':third}],
        event={'description':second,'article_quote':second,'time':'2026년 11월 9일'})
    clean = Analyzer.clean_extraction(raw, ' '.join([first, second, third]))
    assert [t.date for t in clean.context_timeline] == ['8일(현지시간)', '9일', '시점 미확인']  # 날짜 없는 문장은 추정하지 않음
    assert clean.event.time == '9일'


def test_date_in_quote_reads_korean_and_english_expressions():
    from app.service import date_in_quote
    assert date_in_quote('2026년 11월 9일(현지 시간) 발표') == '2026년 11월 9일(현지 시간)'
    assert date_in_quote("He met Kim Jong-il, in 2007.") == '2007년'
    assert date_in_quote('On March 12, 2018 talks began') == 'March 12, 2018'
    assert date_in_quote('his new year message') is None
