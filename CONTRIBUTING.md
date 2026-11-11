# 협업 Git 및 PR 절차
이 문서는 공통 절차만 정의하며 담당자·역할·팀원별 작업량을 지정하지 않는다.

## 시작
1. git status로 기존 변경을 확인한다. 다른 작업의 변경을 덮어쓰거나 reset하지 않는다.
2. git fetch origin --prune 후 원격 기본 브랜치를 확인한다.
3. 작업 트리가 깨끗하면 기본 브랜치를 --ff-only로 갱신하고 별도 브랜치를 만든다.
```powershell
git fetch origin --prune
git switch main
git pull --ff-only origin main
git switch -c feature/간단한-작업명
```
현재 변경이 있으면 먼저 해당 변경의 소유·범위를 확인하고 보존한 채 브랜치를 만든다. 무조건 stash/삭제하지 않는다.

## 변경과 검증
명세·API 계약·테스트를 함께 갱신한다. 기술 스택이나 정상 UI를 불필요하게 바꾸지 않는다.
```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:browser
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/smoke_backend.py
git diff --check
```
브라우저 테스트는 설치된 Chrome과 CHROME_PATH 설정을 사용한다. mock 검사와 실제 API/Chrome 설치 검사를 구분한다.

## 커밋·Push·PR
- .env 및 변형, API 키, 가상환경, node_modules, dist, 도구 캐시·임시 로그를 커밋하지 않는다. .env.example은 허용한다.
- git add 후 staged diff와 파일 목록을 확인하고 `node scripts/check-commit.mjs --staged`를 실행한다.
- 주어진 작업의 구체적인 행동과 결과가 드러나는 커밋 메시지를 작성한다.
- 기본 브랜치 직접 Push와 Force Push를 하지 않는다.
```powershell
git add 변경할-파일
node scripts/check-commit.mjs --staged
git diff --cached --stat
git commit -m "fix: 구체적인 변경"
git push -u origin 현재-기능-브랜치
```
PR에는 문제/결과, 주요 변경, 실제 실행한 검사, 미실행 검사와 제약을 적는다.
변경에 맞춰 README/PROJECT_SPEC/API_SPEC/VALIDATION/MIGRATION을 갱신한다.
API 키나 실제 기사 전문을 PR 본문·로그에 붙이지 않는다.

## 병합
원격 기본 브랜치와 충돌 여부, checks, review, ruleset/보호 규칙을 확인한다.
필수 리뷰·검사를 충족한 경우에만 GitHub PR로 병합한다. 규칙·관리자 제한·실패한 검사를 우회하지 않는다.
이 저장소에서 이번 기준 통합은 사용자가 명시적으로 Push·PR·Merge를 허용했다. 이후 외부 변경은 해당 작업의 승인 범위를 따른다.
병합 후 main을 fetch/pull --ff-only로 갱신하고 테스트·타입·빌드·HTTP smoke를 다시 실행한다.
병합 후 테스트 실패 시 성공으로 보고하지 않고 원인과 해결 상태를 기록한다.
