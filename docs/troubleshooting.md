# Casino Night — 버그 및 기능 개발 이력

> 처음부터 발생한 모든 문제, 원인, 해결 방법, 대안을 정리한 문서입니다.

---

## 1. AWS 비용 조회 너무 잦은 호출

### 증상
관리자 페이지를 열 때마다, 그리고 5분마다 Cost Explorer API를 자동 호출.

### 원인
- `admin.html` 에 `fetchCosts()` 를 로그인 시 즉시 + `setInterval(fetchCosts, 300_000)` 로 5분마다 반복
- Cost Explorer API는 호출당 **$0.01** 과금

### 해결
- 브라우저에서 매일 오전 **10시 KST (01:00 UTC)** 에 1회만 자동 호출
- 수동 "지금 조회" 버튼 추가
- 로그인 시 자동 호출 제거

```javascript
(function scheduleCostAt10amKST() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(1, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(function tick() {
    if (adminToken) fetchCosts();
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
})();
```

### 대안
- CloudWatch Billing Alarm으로 예산 초과 시 알림만 받는 방식 (조회 비용 0)
- AWS Budgets API (한 번 조회로 월 예산 현황 확인)

---

## 2. Admin 페이지 CORS 오류 ("Failed to fetch")

### 증상
`x-admin-token` 커스텀 헤더로 API 요청 시 브라우저가 OPTIONS preflight를 먼저 보내는데,
Lambda가 OPTIONS 응답을 반환하지 않아 CORS 에러 발생.

### 원인
- 브라우저는 커스텀 헤더(`x-admin-token`)가 포함된 요청에 대해 CORS preflight(OPTIONS) 전송
- API Gateway + Lambda에 OPTIONS 처리 로직이 없음

### 해결
- Lambda 핸들러 최상단에 OPTIONS 메서드 처리 추가:
  ```typescript
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', ... } };
  }
  ```
- 모든 응답에 CORS 헤더 추가

### 대안
- API Gateway 레벨에서 CORS 설정 (`aws_apigatewayv2_api` 의 `cors_configuration`)
- 단, 커스텀 헤더(`x-admin-token`)를 `allow_headers`에 명시해야 함

---

## 3. 방 폭파(Destroy) 시 500 에러

### 증상
관리자 페이지에서 💥 폭파 버튼 클릭 시 500 Internal Server Error.

### 원인
`BatchWriteItem` 을 사용하는데 Lambda IAM 역할에 `dynamodb:BatchWriteItem` 권한이 없었음.

### 해결
`iam.tf` 에 `BatchWriteItem` 권한 추가:
```hcl
"dynamodb:BatchWriteItem",
```

### 대안
- `BatchWriteItem` 대신 개별 `DeleteItem` 병렬 실행 (IAM 권한 문제를 우회하지만 비효율적)

---

## 4. Terraform GitHub Actions 실패 (state 파일 없음)

### 증상
GitHub Actions에서 `terraform apply` 실행 시 이미 존재하는 리소스를 새로 생성하려다 충돌.

### 원인
로컬에서 `terraform apply`로 인프라를 만든 후 `terraform.tfstate`가 로컬에만 있고
GitHub Actions CI 서버는 빈 state로 시작 → "리소스가 없다"고 판단해 재생성 시도 → AWS에서 충돌.

### 해결
S3 백엔드로 state 파일 마이그레이션:
```hcl
backend "s3" {
  bucket = "casino-tfstate-097852546028"
  key    = "casino/terraform.tfstate"
  region = "ap-northeast-2"
}
```
```bash
terraform init -migrate-state -force-copy
```

### 대안
- Terraform Cloud (HashiCorp 관리형 state 저장소, 무료 티어 있음)
- 로컬 state + CI에서 `terraform import`로 기존 리소스 import (유지보수 어려움)

---

## 5. 관리자 페이지에 "undefined" 방 표시

### 증상
관리자 페이지에서 방 목록에 상태가 `undefined`, 플레이어 수가 `undefined`로 표시되는 방이 생김.

### 원인
WebSocket 연결 기록(`CONN#`)만 있고 방 메타데이터(`META`)가 없는 **좀비(ghost) 레코드** 발생.
- 폭파(`destroy`) 후 클라이언트가 재연결 시도하거나
- 방이 생성 도중 실패했는데 연결 레코드만 남은 경우

### 해결 (3중 방어)
1. **`admin.ts`**: META 없는 방은 좀비로 분류해 자동 청소
   ```typescript
   if (!r.meta) { zombieIds.push(roomId); continue; }
   ```
2. **`connect.ts`**: WebSocket 연결 시 META 없으면 ROOM_CLOSED 전송 후 연결 기록 삭제
   ```typescript
   if (!metaRes.Item) {
     await sendToConnection(connectionId, { type: 'ROOM_CLOSED', reason: 'not_found' }, callbackUrl);
     return { statusCode: 200 };
   }
   ```
3. **`test-ui.html`**: `ROOM_CLOSED` 수신 시 localStorage 초기화 후 초기 화면으로 복귀

### 대안
- DynamoDB TransactWrite로 META + PLAYER# 를 함께 생성해 원자적으로 처리 (partial write 원천 차단)

---

## 6. 방 폭파 후 방장이 새로고침하면 방 재생성

### 증상
방을 폭파했는데 방장이 브라우저를 새로고침하면 같은 roomId로 방이 다시 생성됨.

### 원인
- localStorage에 `roomId`, `userId` 저장됨
- 새로고침 후 `connectWS()` 호출 → CONN# 레코드 생성
- `ROOM_CLOSED` 핸들러가 없어서 클라이언트가 방이 사라졌다는 걸 모름

### 해결
`test-ui.html`에 `ROOM_CLOSED` 핸들러 추가:
```javascript
case 'ROOM_CLOSED':
  localStorage.removeItem('casino_session');
  toast('방이 종료되었습니다');
  resetToSetup();
  break;
```

### 대안
- 방 생성 시 `sessionStorage` 사용 (탭 닫으면 자동 소멸)
- 다만 진짜 새로고침(실수)에도 세션이 날아가는 UX 문제 있음

---

## 7. 시작 버튼이 폭파 후 작동 안 함

### 증상
방 폭파 후 다른 방에 입장하면 시작 버튼이 클릭되지 않음.

### 원인
폭파 시 `destroy.ts`가 PLAYER# 레코드를 삭제하고 WebSocket 연결을 강제 종료함.
이후 새 방에 입장하면 `START_GAME` 서버 측에서 `activePlayers`를 쿼리하는데 PLAYER# 레코드가 없어 인원수 0 → 시작 불가 반환.

실제로는 입장(`join.ts`)이 PLAYER#를 새로 생성하므로 서버 쪽은 정상이었음.
진짜 원인은 **클라이언트 측**: `S.hostId` 가 이전 방의 상태로 남아 있어 Start 버튼이 비활성화 됨.

### 해결
- `destroy.ts`에 `DeleteConnectionCommand`로 WebSocket 강제 종료 추가
- `resetToSetup()`에서 `S.hostId`, `S.myReady` 초기화
- `ROOM_CLOSED` 핸들러에서 전체 상태 초기화

---

## 8. 나중에 입장한 유저가 기존 플레이어를 못 봄 (1차)

### 증상
방에 먼저 들어온 방장은 후에 입장한 유저를 볼 수 있지만,
나중에 들어온 유저는 방장을 못 보는 현상.

### 원인
DynamoDB **Eventual Consistency**: `connect.ts`에서 PLAYER# 목록을 조회할 때
Eventually consistent read를 사용하면 방금 전 쓰여진 레코드가 안 보일 수 있음.

### 해결 (1차)
`connect.ts` 의 QueryCommand에 `ConsistentRead: true` 추가:
```typescript
ddb.send(new QueryCommand({
  TableName: TABLE,
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
  ExpressionAttributeValues: { ':pk': `ROOM#${roomId}`, ':prefix': 'PLAYER#' },
  ConsistentRead: true,
}))
```

---

## 9. 나중에 입장한 유저가 기존 플레이어를 못 봄 (2차 — 근본 해결)

### 증상
ConsistentRead 적용 후에도 나중에 들어온 유저가 기존 유저를 못 보는 현상 지속.

### 원인 분석
`PLAYER_JOINED` 브로드캐스트만으로는 불충분:
- 방장은 후입장자의 `PLAYER_JOINED`를 받아 목록에 추가 → 정상
- 후입장자는 `ROOM_STATE`를 받지만, `ROOM_STATE`를 **자신에게만** 보내고 기존 플레이어에게는 보내지 않음
- 브라우저 렌더링 타이밍 또는 메시지 유실 시 방장 목록 갱신 누락 가능

### 해결 (근본 해결)
신규 접속자가 연결될 때 **기존 연결된 모든 플레이어에게도 ROOM_STATE 브로드캐스트**:
```typescript
// 기존 플레이어에게 최신 목록 브로드캐스트 (신규 접속자 포함)
await broadcastToRoom(roomId, { ...roomSnapshot, isReconnect: false }, callbackUrl, connectionId);

// 신규 접속자에게 스냅샷 전송
await sendToConnection(connectionId, { ...roomSnapshot, isReconnect }, callbackUrl);
```

이제 누가 새로 들어오든 방의 모든 플레이어가 최신 ROOM_STATE를 받아 목록을 갱신함.

### 대안
- GraphQL Subscription (AppSync) — 상태 동기화를 클라이언트가 pull하는 모델
- 클라이언트가 주기적으로 HTTP poll로 플레이어 목록 조회 (WebSocket 목적에 반함)

---

## 10. 1인 플레이 불가

### 증상
방에 혼자 있을 때 게임 시작 불가.

### 원인
`config/game-config.ts` 의 `minPlayers: 2` 설정.

### 해결
`minPlayers: 1` 로 변경.

### 대안
1인 모드를 별도 분기로 처리 (딜러 vs 플레이어 구도) — 현재는 단순히 인원 수 제한만 해제.

---

## 11. Ready/Start 시스템

### 배경
방장만 게임 시작 가능하게 하고, 다른 플레이어는 준비(Ready)를 눌러야 방장이 시작할 수 있도록 요청.

### 구현
**서버 (`default.ts`)**:
- `START_GAME` 처리 시 방장 여부 확인, 비방장 플레이어 전원 `ready === true` 여야 시작 허용
- `SET_READY` 액션 추가 → PLAYER# 레코드 `ready` 필드 업데이트 → `PLAYER_READY` 브로드캐스트

**클라이언트 (`test-ui.html`)**:
- 방장이면 시작 버튼 표시, 아니면 준비 버튼 표시
- 모든 비방장 플레이어가 준비되어야 시작 버튼 활성화 (방장 혼자면 즉시 활성화)
- 플레이어 목록에 👑 (방장) / ✅ (준비 완료) / ⏳ (미준비) 배지 표시

---

## 12. 방장 인계 기능

### 구현
**서버 (`default.ts`)**:
- `TRANSFER_HOST` 액션 → META 레코드의 `hostId` 업데이트 → `HOST_TRANSFERRED` 브로드캐스트

**클라이언트 (`test-ui.html`)**:
- 방장만 각 플레이어 옆에 "인계" 버튼 표시
- `HOST_TRANSFERRED` 수신 시 `S.hostId` 갱신 → 버튼/배지 재렌더링

---

## 13. Discord 배포/에러 알림

### 구현
**배포 알림 (`deploy.yml`)**:
- GitHub Actions 마지막 스텝에 `if: always()` Discord 웹훅 알림 추가
- 성공(초록)/실패(빨강), 커밋 메시지, 실행자, 브랜치, GitHub Actions 링크 포함
- `DISCORD_WEBHOOK` GitHub Secret에 웹훅 URL 저장 필요

**에러 알림 (`functions/alert/discord.ts`)**:
- CloudWatch Logs 구독 필터 → alert Lambda → Discord 웹훅
- ERROR, UnhandledPromiseRejection, Task timed out 키워드 감지
- 모든 casino Lambda 로그 그룹을 구독

**필요한 GitHub Secret**: `DISCORD_WEBHOOK`

---

## 14. 모니터링 (CloudWatch 대시보드)

### Prometheus + Grafana가 맞지 않는 이유
Prometheus는 **상시 실행 중인 서비스**에서 `/metrics` 엔드포인트를 주기적으로 스크랩하는 방식.
Lambda 함수는 요청 때만 실행되고 종료되므로 스크랩할 엔드포인트 자체가 없음.

### 선택한 방식: CloudWatch 네이티브 대시보드
Terraform으로 CloudWatch 대시보드 자동 생성 (`cloudwatch.tf`):
- Lambda: 호출 수, 에러 수, 실행 시간, 스로틀
- API Gateway HTTP: 요청 수, 4xx/5xx, 지연
- API Gateway WebSocket: 메시지 수
- DynamoDB: 읽기/쓰기 처리량, 에러

`terraform apply` 후 출력되는 `dashboard_url`로 접근.

### Grafana Cloud 원할 경우 (선택)
1. [grafana.com](https://grafana.com) 무료 계정 생성
2. Connections → Add data source → Amazon CloudWatch
3. IAM 사용자 생성 (`CloudWatchReadOnlyAccess` 정책 첨부) → Access Key 발급
4. 위 Key를 Grafana에 입력
5. Dashboard → Import → `grafana-cloudwatch-lambda.json` (커뮤니티 대시보드 ID: 13018)

Prometheus는 불필요, CloudWatch가 데이터 소스 역할을 함.

---

## 요약 테이블

| # | 문제 | 파일 | 핵심 원인 | 해결 |
|---|------|------|-----------|------|
| 1 | 비용 API 과다 호출 | admin.html | setInterval 5분마다 | 매일 10시 KST 1회 |
| 2 | CORS preflight 실패 | */handler.ts | 커스텀 헤더 → OPTIONS | Lambda에서 OPTIONS 처리 |
| 3 | 방 폭파 500 에러 | destroy.ts | IAM BatchWriteItem 누락 | 정책에 권한 추가 |
| 4 | CI/CD state 충돌 | main.tf | 로컬 state만 존재 | S3 backend 마이그레이션 |
| 5 | 유령 방 undefined 표시 | admin.ts, connect.ts | META 없는 CONN# 레코드 | 3중 방어 (정리+거부+클라이언트) |
| 6 | 폭파 후 방 재생성 | test-ui.html | ROOM_CLOSED 핸들러 없음 | localStorage 초기화 |
| 7 | 폭파 후 시작 버튼 불가 | test-ui.html | S.hostId 초기화 누락 | resetToSetup() 초기화 |
| 8 | 후입장자 플레이어 미표시 (1차) | connect.ts | DynamoDB eventual consistency | ConsistentRead: true |
| 9 | 후입장자 플레이어 미표시 (2차) | connect.ts | ROOM_STATE를 신규자만 수신 | 전체 브로드캐스트로 변경 |
| 10 | 1인 플레이 불가 | game-config.ts | minPlayers: 2 | minPlayers: 1 |
| 11 | Ready/Start 시스템 | default.ts, test-ui.html | 없음 | 신규 구현 |
| 12 | 방장 인계 | default.ts, test-ui.html | 없음 | 신규 구현 |
| 13 | Discord 알림 | deploy.yml, alert/discord.ts | 없음 | 신규 구현 |
| 14 | 모니터링 | cloudwatch.tf | Prometheus 서버리스 부적합 | CloudWatch 대시보드 |
