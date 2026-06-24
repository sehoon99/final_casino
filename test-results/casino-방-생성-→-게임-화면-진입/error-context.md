# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: casino.spec.ts >> 방 생성 → 게임 화면 진입
- Location: tests\casino.spec.ts:132:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForSelector: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#game-screen') to be visible
    120 × locator resolved to hidden <div id="game-screen">…</div>

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]: 🎰 Casino Night
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "방 만들기" [level=2] [ref=e6]
      - textbox "닉네임" [ref=e7]: TestUser
      - spinbutton [ref=e8]: "4"
      - button "방 만들기" [active] [ref=e9] [cursor=pointer]
    - generic [ref=e10]:
      - heading "방 참가하기" [level=2] [ref=e11]
      - textbox "방 ID (붙여넣기)" [ref=e12]
      - textbox "닉네임" [ref=e13]
      - button "참가하기" [ref=e14] [cursor=pointer]
```

# Test source

```ts
  36  |   await bob.waitForSelector('#game-screen', { state: 'visible' });
  37  |   await bob.waitForSelector('#conn-status:has-text("✅")');
  38  | 
  39  |   // ── 3. Alice가 블랙잭 시작 ─────────────────────────────────────────────
  40  |   await alice.selectOption('#game-select', 'blackjack');
  41  |   await alice.click('#start-btn');
  42  | 
  43  |   // 게임 영역 노출 대기
  44  |   await alice.waitForSelector('#game-area:not(.hidden)');
  45  |   await bob.waitForSelector('#game-area:not(.hidden)');
  46  | 
  47  |   // 콘솔 메시지 조기 캡처 (버그 진단용)
  48  |   const aliceConsole: string[] = [];
  49  |   const bobConsole: string[] = [];
  50  |   alice.on('console', m => aliceConsole.push(`[${m.type()}] ${m.text()}`));
  51  |   bob.on('console',   m => bobConsole.push(`[${m.type()}] ${m.text()}`));
  52  | 
  53  |   // ── 4. 양쪽 베팅 — UI 클릭 대신 JS 직접 호출 ────────────────────────
  54  |   await alice.evaluate(() => {
  55  |     (document.getElementById('bet-amount') as HTMLInputElement).value = '500';
  56  |     (window as any).placeBet();
  57  |   });
  58  |   console.log('Alice 베팅 전송 완료');
  59  | 
  60  |   await alice.waitForTimeout(600);  // 서버 처리 대기
  61  | 
  62  |   await bob.evaluate(() => {
  63  |     (document.getElementById('bet-amount') as HTMLInputElement).value = '1000';
  64  |     (window as any).placeBet();
  65  |   });
  66  |   console.log('Bob 베팅 전송 완료');
  67  | 
  68  |   // 중간 상태 진단
  69  |   await alice.waitForTimeout(1500);
  70  |   const aliceState = await alice.evaluate(() => {
  71  |     const s = (window as any).S;
  72  |     return {
  73  |       phase: s?.gameState?.data?.phase,
  74  |       myUid: s?.uid,
  75  |       players: s?.gameState?.data?.players ? Object.keys(s.gameState.data.players) : [],
  76  |       dealerCards: s?.gameState?.data?.dealer?.hand?.length ?? 0,
  77  |     };
  78  |   });
  79  |   console.log('Alice 상태:', JSON.stringify(aliceState));
  80  | 
  81  |   // 카드가 나타날 때까지 대기
  82  |   await alice.waitForSelector('.card', { timeout: 12_000 }).catch(async () => {
  83  |     console.log('⚠️ 카드 미노출');
  84  |     console.log('Alice console 최근 5줄:', aliceConsole.slice(-5));
  85  |     const html = await alice.locator('#game-area').innerHTML();
  86  |     console.log('game-area innerHTML(앞 600자):', html.slice(0, 600));
  87  |     throw new Error('카드 미노출');
  88  |   });
  89  |   await bob.waitForSelector('.card', { timeout: 12_000 });
  90  | 
  91  |   // ── 5. Alice 턴 (action-phase 가 보일 때까지 대기 후 스탠드) ────────────
  92  |   await alice.waitForSelector('#action-phase:not(.hidden)', { timeout: 8_000 })
  93  |     .then(() => alice.evaluate(() => (window as any).gameAction('STAND')))
  94  |     .catch(() => console.log('Alice 액션 불필요 (이미 done)'));
  95  | 
  96  |   console.log('Alice 스탠드 전송');
  97  | 
  98  |   // ── 6. Bob 턴 ───────────────────────────────────────────────────────────
  99  |   await bob.waitForSelector('#action-phase:not(.hidden)', { timeout: 8_000 })
  100 |     .then(() => bob.evaluate(() => (window as any).gameAction('STAND')))
  101 |     .catch(() => console.log('Bob 액션 불필요 (이미 done)'));
  102 | 
  103 |   console.log('Bob 스탠드 전송');
  104 | 
  105 |   // ── 7. 라운드 결과 확인 ─────────────────────────────────────────────────
  106 |   // 딜러 애니메이션 후 인플레이스 결과가 dealer-area에 표시됨 (오버레이 없음)
  107 |   await alice.waitForSelector('#result-display:not(.hidden)', { timeout: 15_000 });
  108 |   const resultTitle = await alice.textContent('#result-title');
  109 |   console.log('Alice 결과:', resultTitle);
  110 | 
  111 |   expect(['🎉 승리!', '💀 패배', '🤝 무승부']).toContain(resultTitle?.trim());
  112 | 
  113 |   // 3초 카운트다운 후 result-display가 자동으로 사라짐
  114 |   await alice.waitForSelector('#result-display', { state: 'hidden', timeout: 8_000 });
  115 | 
  116 |   // ── 8. 채팅 테스트 ──────────────────────────────────────────────────────
  117 |   await alice.fill('#chat-input', '안녕 Bob!');
  118 |   await alice.press('#chat-input', 'Enter');
  119 | 
  120 |   // Bob이 메시지 수신 확인
  121 |   await bob.waitForSelector('.chat-msg:has-text("안녕 Bob!")');
  122 |   const chatMsg = await bob.textContent('.chat-msg:has-text("안녕 Bob!")');
  123 |   expect(chatMsg).toContain('안녕 Bob!');
  124 | 
  125 |   console.log('✅ 모든 시나리오 통과');
  126 | 
  127 |   await ctx1.close();
  128 |   await ctx2.close();
  129 | });
  130 | 
  131 | // 단독 테스트들
  132 | test('방 생성 → 게임 화면 진입', async ({ page }) => {
  133 |   await page.goto(URL);
  134 |   await page.fill('#create-name', 'TestUser');
  135 |   await page.click('button:has-text("방 만들기")');
> 136 |   await page.waitForSelector('#game-screen', { state: 'visible' });
      |              ^ Error: page.waitForSelector: Test timeout of 60000ms exceeded.
  137 | 
  138 |   // #badge-rid 에는 room ID만 들어 있고, "방 ID:" 텍스트는 부모에 있음
  139 |   const badge = await page.textContent('#badge-rid');
  140 |   expect(badge).toBeTruthy();
  141 |   expect(badge).not.toBe('...');
  142 | });
  143 | 
  144 | test('잘못된 방 ID로 참가 시 에러', async ({ page }) => {
  145 |   await page.goto(URL);
  146 |   await page.fill('#join-rid',  'invalid-room-id');
  147 |   await page.fill('#join-name', 'Ghost');
  148 |   await page.click('button:has-text("참가하기")');
  149 | 
  150 |   await page.waitForSelector('.toast');
  151 |   const toast = await page.textContent('.toast');
  152 |   expect(toast).toContain('실패');
  153 | });
  154 | 
  155 | test('PING-PONG WebSocket 확인', async ({ browser }) => {
  156 |   const ctx  = await browser.newContext();
  157 |   const page = await ctx.newPage();
  158 | 
  159 |   await page.goto(URL);
  160 |   await page.fill('#create-name', 'PingUser');
  161 |   await page.click('button:has-text("방 만들기")');
  162 |   await page.waitForSelector('#conn-status:has-text("✅")');
  163 | 
  164 |   // 이벤트 로그에 PONG이 찍히도록 WebSocket 직접 호출
  165 |   await page.evaluate(() => (window as any).send({ action: 'PING' }));
  166 |   await page.waitForSelector('.ev-entry:has-text("PONG")');
  167 | 
  168 |   await ctx.close();
  169 | });
  170 | 
```