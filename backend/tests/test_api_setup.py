import asyncio
import importlib.util
from pathlib import Path
from app.errors import ProviderError

path = Path(__file__).resolve().parents[2] / 'scripts/check_api_setup.py'
spec = importlib.util.spec_from_file_location('check_api_setup', path)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def complete(mode='live'):
    return {'ANALYSIS_MODE': mode, 'GEMINI_API_KEY': 'sensitive-gemini-value',
            'LLM_MODEL': 'text-model', 'TAVILY_API_KEY': 'sensitive-tavily-value'}


def no_network(*args, **kwargs):
    raise AssertionError('No external call expected')


def test_default_checks_configuration_only_without_printing_values(monkeypatch, capsys):
    monkeypatch.setattr(setup, 'read_settings', lambda: complete())
    monkeypatch.setattr(setup, 'check_live', no_network)
    monkeypatch.setattr(setup, 'list_models', no_network)
    assert setup.main([]) == 0
    output = capsys.readouterr().out
    assert '입력됨' in output and 'sensitive-' not in output and 'text-model' not in output


def test_missing_keys_and_mock_mode_never_make_live_requests(monkeypatch, capsys):
    monkeypatch.setattr(setup, 'check_live', no_network)
    monkeypatch.setattr(setup, 'read_settings', lambda: {key: '' for key in complete()})
    assert setup.main(['--live']) == 2
    monkeypatch.setattr(setup, 'read_settings', lambda: complete('mock'))
    assert setup.main(['--live']) == 2
    assert '외부 API는 호출하지 않았습니다' in capsys.readouterr().out


def test_env_precedence_and_placeholder_detection(tmp_path):
    path = tmp_path / '.env'
    path.write_text('ANALYSIS_MODE=live\nGEMINI_API_KEY=file-value\nLLM_MODEL=your_model_id\n', encoding='utf8')
    settings = setup.read_settings(path, {'ANALYSIS_MODE': 'mock', 'GEMINI_API_KEY': ''})
    assert settings['ANALYSIS_MODE'] == 'mock' and settings['GEMINI_API_KEY'] == ''
    assert not setup.configured(settings['LLM_MODEL'])
    assert not setup.configured('발급받은_키')


def test_credentials_in_example_file_are_reported_without_exposing_them(tmp_path, monkeypatch, capsys):
    (tmp_path / '.env.example').write_text('GEMINI_API_KEY=private-misfiled-value\n', encoding='utf8')
    monkeypatch.setattr(setup, 'ENV_PATH', tmp_path / '.env')
    monkeypatch.setattr(setup, 'read_settings', lambda: {name: '' for name in complete()})
    monkeypatch.setattr(setup, 'list_models', no_network)
    assert setup.main(['--list-models']) == 2
    output = capsys.readouterr().out
    assert 'backend/.env.example에' in output and '프로그램은 backend/.env를 읽습니다' in output
    assert 'private-misfiled-value' not in output


def test_live_check_uses_project_clients_and_validates_structured_reply(capsys):
    calls = []
    class LLM:
        async def generate(self, instruction, payload, schema):
            calls.append('gemini')
            assert payload == {'task': 'connection_check'}
            return schema(status='ok')
    class Search:
        async def search(self, query):
            calls.append('tavily')
            return []
    assert asyncio.run(setup.check_live(LLM(), Search())) == 0
    assert calls == ['gemini', 'tavily']
    assert capsys.readouterr().out.count('[PASS]') == 2


def test_provider_failures_are_distinct_and_never_expose_exception_text(capsys):
    class LLM:
        async def generate(self, *args):
            raise ValueError('private-key-and-request-content')
    class Search:
        async def search(self, *args):
            raise ProviderError('rate_limited', 'tavily', 11)
    assert asyncio.run(setup.check_live(LLM(), Search())) == 1
    output = capsys.readouterr().out
    assert 'private-key' not in output
    assert 'invalid_response' in output and 'rate_limited' in output and '11초' in output


def test_gemini_only_check_does_not_repeat_successful_tavily_request(capsys):
    class LLM:
        async def generate(self, instruction, payload, schema):
            return schema(status='ok')
    class Search:
        async def search(self, *args):
            raise AssertionError('Tavily must not be called')
    assert asyncio.run(setup.check_live(LLM(), Search(), provider='gemini')) == 0
    output = capsys.readouterr().out
    assert '[PASS] Gemini' in output and 'Tavily' not in output
