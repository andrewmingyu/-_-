import json
import os
import httpx
from .prompts import SYSTEM


class Gemini:
    async def generate(self, instruction, payload, schema):
        from google import genai
        from google.genai import types
        key, model = os.getenv('GEMINI_API_KEY'), os.getenv('LLM_MODEL')
        if not key or not model:
            raise RuntimeError('GEMINI_API_KEY와 LLM_MODEL 설정이 필요합니다.')
        async with genai.Client(api_key=key, http_options={'timeout': 45000}).aio as client:
            response = await client.models.generate_content(
                model=model, contents=instruction + '\nDATA:\n' + json.dumps(payload, ensure_ascii=False),
                config=types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0,
                    response_mime_type='application/json', response_json_schema=schema.model_json_schema()))
        return schema.model_validate_json(response.text)


class Tavily:
    async def search(self, query, topic='general'):
        key = os.getenv('TAVILY_API_KEY')
        if not key:
            raise RuntimeError('검색 키가 설정되지 않았습니다.')
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post('https://api.tavily.com/search',
                headers={'Authorization': f'Bearer {key}'}, json={
                    'query': query, 'topic': topic, 'max_results': 5, 'include_raw_content': True,
                    'include_answer': False, 'search_depth': 'basic'})
            response.raise_for_status()
            data = response.json()
            if not isinstance(data.get('results'), list):
                raise ValueError('잘못된 검색 응답')
            return data['results']
