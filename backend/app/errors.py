from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


class ProviderError(Exception):
    def __init__(self, code, provider, retry_after_seconds=None):
        self.code, self.provider = code, provider
        self.retry_after_seconds = retry_after_seconds
        super().__init__(code)

    @property
    def message(self):
        return {'configuration_missing': '공급자 키 또는 모델 설정이 필요합니다.',
            'rate_limited': '공급자의 요청 한도에 도달했습니다.',
            'timeout': '공급자 응답 대기 시간이 초과되었습니다.',
            'network_error': '공급자에 연결하지 못했습니다.',
            'invalid_response': '공급자 응답 형식이 올바르지 않습니다.',
            'provider_error': '공급자 요청을 완료하지 못했습니다.'}[self.code]

    @property
    def http_status(self):
        return {'configuration_missing': 503, 'rate_limited': 429, 'timeout': 504}.get(self.code, 502)


def retry_after(value):
    try:
        seconds = int(value)
    except (ValueError, TypeError):
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, AttributeError):
            return None
    return min(86400, max(0, seconds))
