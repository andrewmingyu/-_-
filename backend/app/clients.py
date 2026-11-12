import json
import os
import httpx
from pydantic import ValidationError
from .errors import ProviderError, retry_after
from .prompts import SYSTEM

def provider_failure(exc, provider):
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return ProviderError('timeout', provider)
    if isinstance(exc, (ValidationError, ValueError)):
        return ProviderError('invalid_response', provider)
    status = getattr(exc, 'code', None) or getattr(getattr(exc, 'response', None), 'status_code', None)
    try:
        status = int(status)
    except (TypeError, ValueError):
        status = None
    headers = getattr(getattr(exc, 'response', None), 'headers', {}) or {}
    if status == 429:
        return ProviderError('rate_limited', provider, retry_after(headers.get('Retry-After')))
    if status in (408,504):
        return ProviderError('timeout',provider)
    if status in (400,401,402,403,404):
        code = {400:'invalid_request',401:'authentication_failed',402:'billing_required',
                403:'permission_denied',404:'request_not_found'}[status]
        return ProviderError(code, provider)
    if status in (500,502,503):
        return ProviderError('provider_unavailable', provider, retry_after(headers.get('Retry-After')))
    if isinstance(exc, httpx.RequestError):
        return ProviderError('network_error', provider)
    return ProviderError('provider_error', provider)

class Gemini:
    async def generate(self, instruction, payload, schema):
        key, model = os.getenv('GEMINI_API_KEY'), os.getenv('LLM_MODEL')
        if not key or not model:
            raise ProviderError('configuration_missing', 'gemini')
        from google import genai
        from google.genai import types
        try:
            async with genai.Client(api_key=key, http_options={'timeout': 45000, 'retry_options': {'attempts': 1}}).aio as client:
                response = await client.models.generate_content(
                    model=model, contents=instruction + '\nDATA:\n' + json.dumps(payload, ensure_ascii=False),
                    config=types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0,
                        response_mime_type='application/json', response_json_schema=schema.model_json_schema()))
            return schema.model_validate_json(response.text)
        except Exception as exc:
            raise provider_failure(exc, 'gemini') from exc

class Tavily:
    async def _request(self, endpoint, payload):
        key = os.getenv('TAVILY_API_KEY')
        if not key:
            raise ProviderError('configuration_missing', 'tavily')
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                response = await client.post('https://api.tavily.com/' + endpoint,
                    headers={'Authorization': f'Bearer {key}'}, json=payload)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data.get('results'), list):
                    raise ValueError('Invalid provider response')
                return data['results']
        except Exception as exc:
            raise provider_failure(exc, 'tavily') from exc

    async def search(self, query, topic='general'):
        return await self._request('search', {'query': query, 'topic': topic, 'max_results': 5,
            'include_raw_content': True, 'include_answer': False, 'search_depth': 'basic'})

    async def extract(self, urls):
        # Called only for URLs already returned by search; the server never fetches arbitrary URLs.
        return await self._request('extract', {'urls': urls[:3], 'include_images': False})
