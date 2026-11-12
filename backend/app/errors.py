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
            'invalid_request': '공급자가 요청 형식이나 모델 설정을 허용하지 않았습니다.',
            'authentication_failed': '공급자 API 키 인증에 실패했습니다. 키 설정을 확인해 주세요.',
            'permission_denied': '공급자 API 접근 권한이 없습니다. 프로젝트·계정 상태를 확인해 주세요.',
            'request_not_found': '요청한 모델 또는 공급자 API 경로를 찾을 수 없습니다.',
            'billing_required': '공급자 계정의 결제·사용량 상태를 확인해야 합니다.',
            'provider_unavailable': '공급자 서비스가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            'provider_error': '공급자 요청을 완료하지 못했습니다.'}[self.code]

    @property
    def http_status(self):
        return {'configuration_missing': 503, 'rate_limited': 429, 'timeout': 504,
                'provider_unavailable': 503, 'billing_required': 503}.get(self.code, 502)


def retry_after(value):
    try:
        seconds = int(value)
    except (ValueError, TypeError):
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, AttributeError):
            return None
    return min(86400, max(0, seconds))
