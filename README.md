# Meal Note

Notion에 기록한 식단을 필라테스 강사와 공유하고, 강사가 날짜별 총평을 남기는 모바일 웹 앱입니다. 기존 Meal Log와 Daily Review 데이터 소스를 사용합니다. 제품 요구사항과 디자인 시안은 [docs](docs), [design](design)에 있습니다.

## 로컬 실행

Node.js 24와 npm을 사용합니다.

1. `npm ci`로 의존성을 설치합니다.
2. `.env.example`을 `.env.local`로 복사하고 값을 설정합니다.
3. `npm run notion:check`로 두 데이터 소스의 속성 이름과 타입, 리뷰 상태 옵션을 확인합니다.
4. `npm run dev`로 실행하고, 별도 터미널에서 `npm run link -- rotate`로 강사 전용 링크를 발급합니다.

| 설정 | 값 |
| --- | --- |
| `NOTION_TOKEN` | 기존 데이터베이스 두 곳에 연결된 내부 통합 토큰. 읽기, 생성, 수정 권한 필요 |
| `NOTION_MEAL_LOG_DATA_SOURCE_ID` | Meal Log 데이터 소스 ID |
| `NOTION_DAILY_REVIEW_DATA_SOURCE_ID` | Daily Review 데이터 소스 ID |
| `AUTH_STORE_URL`, `AUTH_STORE_TOKEN` | 지속성 있는 Upstash Redis REST URL과 쓰기 토큰. EVAL과 만료 설정 사용 |
| `APP_ORIGIN` | 개발 환경은 `http://localhost:3000`, 운영 환경은 실제 HTTPS 오리진 |

## 링크 발급과 폐기

`npm run link -- rotate`는 링크를 터미널에 한 번 출력합니다. 운영자가 신뢰하는 터미널에서 직접 실행하고 강사에게 개별 전달합니다. 링크 소지자는 강사 권한으로 접속할 수 있습니다. Redis에는 링크와 세션의 해시를 저장합니다. 링크는 발급 후 30일, 세션은 접속 후 최대 8시간 동안 유효합니다. 교체하거나 `npm run link -- revoke`를 실행하면 이전 링크와 기존 세션이 폐기됩니다. 실패한 교환은 서비스 전체에 5분당 30회로 제한합니다.

## 저장과 사진 처리

총평 생성은 날짜별 Redis 잠금과 지속 생성 표식으로 보호합니다. Notion에 저장 요청이 전달된 상태에서 응답이 유실되면 날짜를 다시 조회합니다. 같은 날 Notion 결과가 일시적으로 비어 있더라도 생성 표식이 남아 있는 동안 두 번째 생성을 막습니다. 생성 표식은 데이터에 해당하므로 Redis의 자동 퇴거를 끄고 운영 환경에서 지속적으로 보존합니다.

저장 결과가 불명확하고 총평이 계속 보이지 않으면 운영자가 해당 날짜의 레코드와 지연된 쓰기 완료 여부를 확인해야 합니다. 생성이 실패했음이 확인되면 운영 Redis의 `meal:review:create:YYYY-MM-DD` 키 한 개를 지운 뒤 같은 날짜의 저장을 다시 시도합니다. 운영자가 기존 총평을 의도적으로 삭제하고 재작성을 허용해야 할 때도 같은 절차를 적용합니다. 중복 총평이 이미 있으면 앱은 409를 반환합니다. 운영자가 Notion에서 해당 날짜의 레코드를 확인하고 정리합니다.

사진은 Notion에 업로드한 허용 이미지 형식을 인증 프록시로 표시합니다. 프록시는 요청마다 공유 여부와 날짜를 확인하며 서명 URL이 만료되면 다시 조회합니다. 외부 링크 첨부는 표시 대상에서 제외합니다.

## 검사와 배포

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`를 실행합니다.
- 배포 환경에 서버 환경 변수를 설정하고 운영용 Redis를 연결합니다.
- 실제 Notion 환경에서 속성 확인 명령을 실행한 뒤 테스트용 공유·비공유 행과 총평으로 [수용 기준](qa/ACCEPTANCE.md)을 확인합니다.
- iPhone Safari에서 날짜 선택, 사진 보기, 키보드를 연 상태에서 총평 작성을 확인합니다.
- 운영 도메인에서 인증과 만료를 확인한 뒤 강사용 링크를 발급합니다.

이 구현에서 자동 테스트는 가상 Notion/Redis 응답을 사용합니다. 실제 운영 환경에는 배포하지 않았습니다. Notion 데이터 소스 쿼리는 [공식 API 문서](https://developers.notion.com/reference/query-a-data-source)의 2026-03-11 버전을 사용합니다.
