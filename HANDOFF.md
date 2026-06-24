# Casino Night — 프로젝트 핸드오프 문서

> 이 문서는 VSCode + Claude Code에서 진행된 설계 대화를 Kiro로 이전하기 위해 작성되었습니다.
> 아래 내용을 Kiro의 AI에게 붙여넣기하면 동일한 맥락에서 대화를 이어갈 수 있습니다.

---

## 대화 요약 (질문 → 결정 순서)

---

### Q1. 프로젝트 개요

**사용자 질문:**
> 온라인 도박 사이트를 만들려고 하는데, 실제 돈은 걸지 않고 친구들끼리 방을 만들어서 다양한 게임을 동시에 즐기고 자금이 마지막까지 남아있는 사람이 승리하는 1위 결정 게임. 실제 카지노 게임 + 새로운 게임 포함. AFK 방지 페널티 포함. 모든 파라미터를 하나의 파일에서 관리. 유지보수 운영성 좋게. Serverless 개념 활용. AWS 환경. Kiro에서 유지보수 계획. 플랜 세워줘.

**결정 사항:**
- 프로젝트명: Casino Night
- 실제 돈 없는 버추얼 칩 기반 토너먼트 플랫폼
- 마지막 생존자(잔고 0 이하 탈락) 방식
- AFK 페널티 시스템 포함
- 모든 파라미터 `config/game-config.ts` 단일 파일 관리
- AWS 완전 서버리스 아키텍처
- Kiro IDE로 유지보수

---

### Q2. 2D vs 3D

**사용자 질문:**
> 2D로 하는게 좋을지 3D로 하는게 좋을지. 유저들이 서로 자산 상태와 어떤 게임을 하는지 명확하게 볼 수 있고, 서로 대화 및 상호작용할 수 있으면 좋겠음. 3D로 브라우저에서 실행하면 어떤 문제점이 있는지.

**3D 브라우저 문제점 (검토 결과):**
- 성능: GPU 부담, 여러 게임 동시 렌더링 시 프레임 드랍
- 로딩: 3D 에셋 번들 10~30MB 이상, 초기 로딩 5~15초
- 정보 가독성: 원근감이 오히려 카드/칩/숫자 파악 방해
- 개발/유지보수: Three.js 전문성 필요, Kiro AI 맥락 파악 어려움
- 브라우저 호환: WebGL 블록 환경 존재

**결정 사항: 2D with Depth Feel 채택**
- CSS `rotateY()` 카드 플립 애니메이션 (3D감, 비용 없음)
- Framer Motion 칩 이동 애니메이션
- SVG 탑다운 테이블 뷰
- 그라디언트·그림자로 깊이감 표현
- 플레이어 상호작용: 이모지 리액션, 채팅 말풍선, 칩 던지기 애니메이션

---

### Q3. MSA 구조 여부

**사용자 질문:**
> MSA로 짜야 하나? 이식성/확장성 좋게. 예를 들어 나중에 1등이 바뀔 때마다 알람 같은 기능도 추가될 수 있음.

**검토 결과:**
- Pure MSA는 이 프로젝트에 과잉설계
- Lambda 자체가 이미 마이크로서비스
- 진짜 문제는 서비스 분리가 아니라 서비스 간 통신 방식

**결정 사항: Event-Driven Modular Serverless 채택**

```
게임 Lambda → EventBridge: "RANK_CHANGED" 이벤트 발행
                ├→ 알림 Lambda    (구독)
                ├→ 리더보드 Lambda (구독)
                ├→ 기록 Lambda    (구독)
                └→ [미래] Discord Webhook Lambda (구독자 추가만 하면 됨)
```

새 기능 추가 = 기존 코드 수정 없이 구독자 Lambda 하나 추가

---

### Q4. Kiro vs VSCode 시작점

**사용자 질문:**
> 지금 VSCode인데 Kiro에서 시작하는게 낫나?

**결정 사항: Kiro로 시작**
- 프로젝트가 처음부터 `.kiro/` 구조로 설계됨
- Specs: 요구사항 기반 코드 자동 생성 (새 게임 추가 시 특히 유용)
- Steering: 코딩 컨벤션 1회 정의 → 모든 AI 생성 코드에 자동 적용
- Hooks: 새 게임 파일 생성 시 보일러플레이트 자동 생성
- Kiro는 VSCode 포크 → 단축키/확장 동일, 전환 비용 거의 없음

---

### Q5. Kiro에서 Claude Code 사용 가능 여부

**사용자 질문:**
> Kiro에서도 Claude랑 대화 가능하고 파일 수정 가능해?

**결론: 가능, 두 가지 방식**

| 방식 | 설명 |
|---|---|
| Kiro 내장 AI | Claude (Bedrock 경유), Specs/Hooks/Steering 연동 |
| Claude Code CLI | Kiro 터미널에서 `claude` 실행, 지금과 동일한 대화 가능 |

**역할 분담:**
- Kiro 내장 AI → Spec 기반 구현, Hooks 자동화
- Claude Code CLI → 복잡한 설계 논의, 다중 파일 수정, 아키텍처 결정

---

## 확정된 아키텍처

### 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Hosting | S3 + CloudFront |
| 실시간 | API Gateway WebSocket |
| Auth | Amazon Cognito |
| API | API Gateway + Lambda (TypeScript) |
| DB | DynamoDB (Single-table design) |
| AFK 감지 | EventBridge Scheduler |
| 이벤트 처리 | SQS FIFO |
| Config | SSM Parameter Store + 로컬 config 파일 |
| IaC | Terraform |
| Monorepo | Turborepo |

### 프로젝트 구조

```
casino-platform/
├── .kiro/
│   ├── specs/
│   │   ├── room-management.md
│   │   ├── game-engine.md
│   │   └── afk-system.md
│   └── steering/
│       ├── structure.md
│       └── conventions.md
│
├── config/
│   └── game-config.ts          # 🔑 모든 파라미터 단일 진실 원천
│
├── packages/
│   ├── shared/                 # 공유 타입, 상수, 유틸
│   ├── frontend/               # Next.js
│   └── backend/
│       └── functions/
│           ├── auth/
│           ├── room/
│           ├── websocket/
│           ├── player/
│           ├── leaderboard/
│           ├── notification/
│           ├── scheduler/      # AFK 감지
│           ├── history/
│           └── games/
│               ├── _engine/   # GameEngine 인터페이스 (공통)
│               ├── blackjack/
│               ├── roulette/
│               ├── baccarat/
│               ├── slots/
│               ├── hi-lo/
│               └── war/
│
└── infrastructure/
    └── terraform/
        ├── modules/
        │   ├── api-gateway/
        │   ├── lambda/
        │   ├── dynamodb/
        │   ├── cognito/
        │   ├── eventbridge/
        │   └── sqs/
        └── environments/
            ├── dev/
            └── prod/
```

### 중앙 Config 파일 설계

```typescript
// config/game-config.ts
export const GameConfig = {
  room: {
    maxPlayers: 8,
    minPlayers: 2,
    startingBalance: 10_000,
    maxDurationMs: 30 * 60_000,
  },

  afk: {
    warningAfterMs:  60_000,   // 1분 후 경고
    penaltyAfterMs: 120_000,   // 2분 후 페널티
    penaltyAmount:      500,
    checkIntervalMs:  30_000,
  },

  winCondition: {
    type: 'last-standing',
    bankruptThreshold: 0,
  },

  games: {
    blackjack: { minBet: 100, maxBet: 5_000, decks: 6 },
    roulette:  { minBet:  50, maxBet: 2_000 },
    baccarat:  { minBet: 200, maxBet: 5_000 },
    slots:     { minBet:  10, maxBet: 1_000, reels: 5 },
    hiLo:      { minBet:  50, maxBet: 3_000 },
  },
} as const;
```

### 게임 엔진 플러그인 인터페이스

```typescript
interface GameEngine {
  id: string;
  name: string;
  minPlayers: number;

  initialize(players: Player[], config: GameConfig): GameState;
  processAction(state: GameState, action: PlayerAction): GameState;
  isRoundOver(state: GameState): boolean;
  calculatePayouts(state: GameState): Payout[];
}
```
새 게임 추가 = 이 인터페이스 구현만 하면 자동 등록

### DynamoDB Single-Table 설계

```
PK                    SK                   용도
────────────────────────────────────────────────────
ROOM#{roomId}         META                 방 정보
ROOM#{roomId}         PLAYER#{userId}      플레이어 잔고/상태
ROOM#{roomId}         GAME#{gameId}        게임 상태 (JSON)
ROOM#{roomId}         AFK#{userId}         마지막 베팅 시각 (TTL)
USER#{userId}         PROFILE              유저 정보
```

### 이벤트 목록 (EventBridge)

```
ROOM_CREATED       방 생성
GAME_STARTED       게임 시작
BALANCE_CHANGED    잔고 변경     → 대시보드 잔고 바 갱신
RANK_CHANGED       순위 변경     → 1등 변경 알림, 리더보드 갱신
ROUND_ENDED        라운드 종료
AFK_DETECTED       AFK 감지      → 경고/페널티
PLAYER_BANKRUPT    플레이어 탈락 → 대시보드 그레이아웃
```

### 대시보드 UI 구조

```
┌─────────────────────────────────────────────────────┐
│  [플레이어 HUD - 항상 표시]                          │
│  👤 김철수  ████████░░  8,200칩  🃏 블랙잭 중        │
│  👤 이영희  ██████████ 10,000칩  🎰 슬롯 중          │
│  👤 박민준  ███░░░░░░░  3,100칩  ⚠️ AFK 경고         │
│  👤 최지우  ░░░░░░░░░░     0칩  💀 탈락               │
├─────────────────────────────────────────────────────┤
│                                                      │
│         [카지노 테이블 - 탑다운 2D 뷰]               │
│                                                      │
│    🃏 J♠  🃏 7♥           [베팅: 500칩]              │
│    딜러: 16   나: 18   → [히트] [스탠드]             │
│                                                      │
├─────────────────────────────────────────────────────┤
│  💬 채팅 + 이모지 반응  [😂][😤][🎉][💀]            │
└─────────────────────────────────────────────────────┘
```

---

## 구현 Phase 계획

| Phase | 내용 |
|---|---|
| 1. 인프라 | Terraform: DynamoDB, Lambda, API GW, Cognito, SQS, EventBridge |
| 2. 방 시스템 | 방 생성/참가, WebSocket 연결, 플레이어 관리 |
| 3. 게임 엔진 | 플러그인 인터페이스 + 블랙잭·룰렛·바카라·슬롯 구현 |
| 4. 게임 메카닉 | 잔고 관리, AFK 감지·페널티, 탈락, 승자 결정 |
| 5. 프론트엔드 | Next.js 대시보드 + 게임 UI + 실시간 WebSocket |
| 6. Kiro 연동 | Specs 작성, Hooks 설정, Steering 규칙 정의 |

---

## Kiro에서 시작 순서

```
1. Kiro 설치 (kiro.dev)
2. 이 프로젝트 폴더 열기
3. .kiro/steering/conventions.md 작성  ← 가장 먼저
4. .kiro/steering/structure.md 작성
5. config/game-config.ts 생성
6. .kiro/specs/game-engine.md 작성
7. Phase 1 Terraform 인프라부터 구현 시작
```

---

## 미결 사항 (Kiro에서 이어서 결정)

- [ ] 프론트엔드 프레임워크 최종 확인 (Next.js 14 유력)
- [ ] Phase 3 게임 구현 우선순위 (블랙잭 → 룰렛 → 바카라 순 추천)
- [ ] 방 안 게임 구조: 플레이어가 여러 테이블 자유 이동 vs 방 전체가 같은 게임
- [ ] Route 53 + 커스텀 도메인 포함 여부
- [ ] Draft 개발 시작 Phase (Phase 1 인프라부터 or 게임 로직 먼저 프로토타입)
