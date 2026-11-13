import asyncio
import json
from types import SimpleNamespace
import pytest
from app import clients
from app.clients import Gemini, model_chain
from app.errors import ProviderError
from app.models import Extraction

GOOD = {'summary': '시연', 'claims': [], 'evidence_mentions': [], 'headline_difference': '미확인'}


class ApiError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('dummy')


def install(monkeypatch, behaviour, calls):
    """behaviour: 모델 ID -> 예외 코드(int) 또는 응답 텍스트."""
    from google import genai

    class FakeAsync:
        def __init__(self):
            self.models = self
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def generate_content(self, **kwargs):
            calls.append(kwargs['model'])
            result = behaviour[kwargs['model']]
            if isinstance(result, int):
                raise ApiError(result)
            return SimpleNamespace(text=result)

    monkeypatch.setattr(genai, 'Client', lambda **kw: SimpleNamespace(aio=FakeAsync()))


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'demo-test-key')
    monkeypatch.setenv('LLM_MODEL', 'model-a')
    monkeypatch.setenv('LLM_FALLBACK_MODELS', 'model-b, model-c')
    monkeypatch.delenv('LLM_MAX_ATTEMPTS', raising=False)


def run():
    return asyncio.run(Gemini().generate('instruction', {'body': '본문'}, Extraction))


def test_chain_order_dedup_and_off(monkeypatch):
    assert model_chain() == ['model-a', 'model-b', 'model-c']
    monkeypatch.setenv('LLM_FALLBACK_MODELS', 'model-a,model-b,bad model!')
    assert model_chain() == ['model-a', 'model-b']
    monkeypatch.setenv('LLM_FALLBACK_MODELS', 'off')
    assert model_chain() == ['model-a']
    monkeypatch.delenv('LLM_FALLBACK_MODELS')
    assert model_chain()[0] == 'model-a' and len(model_chain()) > 1


@pytest.mark.parametrize('status', [429, 503, 504, 404, 400])
def test_switches_to_next_model_on_retryable_failure(monkeypatch, status):
    calls = []
    install(monkeypatch, {'model-a': status, 'model-b': json.dumps(GOOD)}, calls)
    assert run().summary == '시연'
    assert calls == ['model-a', 'model-b']


def test_invalid_response_falls_back(monkeypatch):
    calls = []
    install(monkeypatch, {'model-a': 'not json', 'model-b': json.dumps(GOOD)}, calls)
    assert run().summary == '시연' and calls == ['model-a', 'model-b']


@pytest.mark.parametrize('status,code', [(401, 'authentication_failed'), (403, 'permission_denied'), (402, 'billing_required')])
def test_auth_errors_do_not_switch(monkeypatch, status, code):
    calls = []
    install(monkeypatch, {'model-a': status, 'model-b': json.dumps(GOOD)}, calls)
    with pytest.raises(ProviderError) as caught:
        run()
    assert caught.value.code == code and calls == ['model-a']


def test_all_fail_reports_real_cause_not_404(monkeypatch):
    calls = []
    install(monkeypatch, {'model-a': 404, 'model-b': 429, 'model-c': 503}, calls)
    with pytest.raises(ProviderError) as caught:
        run()
    assert caught.value.code == 'rate_limited' and calls == ['model-a', 'model-b', 'model-c']


def test_attempt_cap(monkeypatch):
    calls = []
    monkeypatch.setenv('LLM_MAX_ATTEMPTS', '2')
    install(monkeypatch, {'model-a': 503, 'model-b': 503, 'model-c': json.dumps(GOOD)}, calls)
    with pytest.raises(ProviderError):
        run()
    assert calls == ['model-a', 'model-b']


def test_failed_model_is_skipped_during_cooldown(monkeypatch):
    calls = []
    install(monkeypatch, {'model-a': 429, 'model-b': json.dumps(GOOD), 'model-c': json.dumps(GOOD)}, calls)
    gemini = Gemini()
    asyncio.run(gemini.generate('i', {}, Extraction))
    asyncio.run(gemini.generate('i', {}, Extraction))
    assert calls == ['model-a', 'model-b', 'model-b']


def test_empty_caution_reasons_are_ignored(monkeypatch):
    data = dict(GOOD, claims=[{'caution': {'reasons': ['']}}])
    # 모델이 넣은 caution은 검증 전에 제거되므로 빈 문자열 때문에 실패하지 않는다.
    assert clients.strip_server_fields(json.loads(json.dumps(data)))['claims'] == [{}]


def test_missing_config_still_raises(monkeypatch):
    monkeypatch.delenv('LLM_MODEL')
    with pytest.raises(ProviderError) as caught:
        run()
    assert caught.value.code == 'configuration_missing'
