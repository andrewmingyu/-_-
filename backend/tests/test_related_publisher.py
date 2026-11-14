from app.service import publisher_name, same_article, iso_date


def test_publisher_from_press_list_including_foreign_outlets():
    assert publisher_name('https://www.bbc.com/news/world-asia-1') == 'BBC'
    assert publisher_name('https://www.theatlantic.com/x', None, 'Title - The Atlantic') == 'The Atlantic'
    assert publisher_name('https://www.chosun.com/x') == '조선일보'


def test_publisher_from_title_suffix_only_when_it_matches_domain():
    assert publisher_name('https://www.koreaherald.com/x', None, 'Story - The Korea Herald') == 'The Korea Herald'
    # 제목 끝이 도메인과 무관하면 언론사 이름으로 쓰지 않고 도메인을 보여준다
    assert publisher_name('https://example-blog.net/x', None, 'Trump - Kim summit') == 'example-blog.net'


def test_explicit_publisher_wins():
    assert publisher_name('https://unknown.example/x', '가람뉴스') == '가람뉴스'


def test_same_article_ignores_tracking_query_and_site_suffix():
    page = 'https://www.yna.co.kr/view/AKR20261109132700083?input=1195m'
    assert same_article('https://www.yna.co.kr/view/AKR20261109132700083', '제목 | 연합뉴스', page, '제목')
    assert not same_article('https://www.yna.co.kr/view/AKR20261109999999999', '다른 기사 | 연합뉴스', page, '제목')


def test_search_dates_are_normalized_to_iso():
    assert iso_date('Sat, 13 Jul 2019 10:00:00 GMT') == '2019-07-13T10:00:00+00:00'
    assert iso_date('2026-11-09') == '2026-11-09'
    assert iso_date('not a date') is None
