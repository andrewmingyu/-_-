from app.models import Extraction
from app.service import Analyzer, grounded_name, speaker_from_sentence, attribution_before

TEXT = ('14일 연합뉴스에 따르면 춘천지법 형사1단독 정종건 부장판사는 스토킹 처벌법 위반 혐의로 기소된 A(23)씨에게 벌금 100만원을 선고하고, '
        '40시간의 스토킹 치료프로그램 이수를 명령했다. 특히 A씨는 경찰로부터 연락하지 말라는 경고를 받고도 16차례에 걸쳐 DM을 보낸 것으로 조사됐다. '
        '재판부는 "범행을 지속해 죄책이 가볍지 않다"고 지적했다.')
C1 = '춘천지법 형사1단독 정종건 부장판사는 스토킹 처벌법 위반 혐의로 기소된 A(23)씨에게 벌금 100만원을 선고하고, 40시간의 스토킹 치료프로그램 이수를 명령했다.'
C2 = '특히 A씨는 경찰로부터 연락하지 말라는 경고를 받고도 16차례에 걸쳐 DM을 보낸 것으로 조사됐다.'


def test_name_matching_tolerates_spacing_only():
    assert grounded_name('춘천지법 형사 1단독', TEXT) == '춘천지법 형사1단독'
    assert grounded_name('서울중앙지법', TEXT) is None


def test_speaker_comes_from_the_sentence_subject_only_for_saying_or_deciding_verbs():
    assert speaker_from_sentence(C1) == '춘천지법 형사1단독 정종건 부장판사'
    assert speaker_from_sentence('재판부는 "범행을 지속해 죄책이 가볍지 않다"고 지적했다.') == '재판부'
    assert speaker_from_sentence('이에 이준석 의원은 "졸업장은 이미 공개했다"고 반박했다.') == '이준석 의원'
    assert speaker_from_sentence(C2) is None                       # 수동형: 주체를 추정하지 않음
    assert speaker_from_sentence('그는 "사실이 아니다"고 말했다.') is None  # 대명사


def test_according_to_phrase_before_the_claim_is_found():
    assert attribution_before(TEXT, C1) == ('14일 연합뉴스에 따르면', '연합뉴스')
    assert attribution_before(TEXT, C2) is None


def test_cleanup_fills_speaker_and_adds_the_according_to_source():
    raw = Extraction(summary=C1, headline_difference='', claims=[
        {'id': 'c1', 'original_text': C1, 'claim_text': C1, 'claim_type': 'factual_narration', 'speaker': None},
        {'id': 'c2', 'original_text': C2, 'claim_text': C2, 'claim_type': 'factual_narration', 'speaker': '경찰'}],
        evidence_mentions=[])
    clean = Analyzer.clean_extraction(raw, TEXT)
    c1, c2 = clean.claims
    assert c1.speaker == '춘천지법 형사1단독 정종건 부장판사'
    assert c2.speaker == '경찰'          # '경찰'은 본문에 실제로 있는 글자
    added = [m for m in clean.evidence_mentions if 'c1' in m.claim_ids]
    assert len(added) == 1 and added[0].article_quote == '14일 연합뉴스에 따르면'
    assert added[0].source_label == '연합뉴스' and added[0].source_kind == 'news_report'
    assert not [m for m in clean.evidence_mentions if 'c2' in m.claim_ids]


def test_model_speaker_with_different_spacing_is_kept_in_article_spelling():
    raw = Extraction(summary=C1, headline_difference='', claims=[
        {'id': 'c1', 'original_text': C1, 'claim_text': C1, 'claim_type': 'factual_narration', 'speaker': '춘천지법 형사 1단독 정종건 부장판사'}],
        evidence_mentions=[])
    assert Analyzer.clean_extraction(raw, TEXT).claims[0].speaker == '춘천지법 형사1단독 정종건 부장판사'
