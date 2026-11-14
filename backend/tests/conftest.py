import pytest


@pytest.fixture(autouse=True)
def extra_searches_off_by_default(monkeypatch):
    # 영어 검색어 생성(LLM 1회)과 후속 보도 검색(Tavily 1회)은 호출 횟수를 세는 기존 테스트를 흔들지 않도록 끈다.
    monkeypatch.setenv('ENGLISH_SEARCH', 'off')
    monkeypatch.setenv('FOLLOWUP_SEARCH', 'off')
