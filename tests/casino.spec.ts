import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

const URL = 'http://localhost:3000';

// 두 플레이어가 방을 만들고 블랙잭을 플레이하는 전체 시나리오
test('블랙잭 전체 시나리오 (Alice + Bob)', async ({ browser }) => {
  // 두 개의 독립적인 브라우저 컨텍스트 = 두 명의 플레이어
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const alice = await ctx1.newPage();
  const bob   = await ctx2.newPage();

  // ── 1. Alice가 방 생성 ──────────────────────────────────────────────────
  await alice.goto(URL);
  await alice.evaluate(() => localStorage.removeItem('casino_night_session'));
  await alice.fill('#create-name', 'Alice');
  await alice.fill('#create-max',  '2');
  await alice.click('button:has-text("방 만들기")');

  // 게임 화면으로 전환될 때까지 대기
  await alice.waitForSelector('#game-screen', { state: 'visible' });
  await alice.waitForSelector('#conn-status:has-text("✅")');

  // roomId 추출
  const roomId: string = await alice.evaluate(() => (window as any).S.roomId);
  expect(roomId).toBeTruthy();
  console.log('Room ID:', roomId);

  // ── 2. Bob이 방 참가 ────────────────────────────────────────────────────
  await bob.goto(URL);
  await bob.evaluate(() => localStorage.removeItem('casino_night_session'));
  await bob.fill('#join-rid',  roomId);
  await bob.fill('#join-name', 'Bob');
  await bob.click('button:has-text("참가하기")');

  await bob.waitForSelector('#game-screen', { state: 'visible' });
  await bob.waitForSelector('#conn-status:has-text("✅")');

  // ── 3. Alice가 블랙잭 시작 ─────────────────────────────────────────────
  await alice.selectOption('#game-select', 'blackjack');
  await alice.click('#start-btn');

  // 게임 영역 노출 대기
  await alice.waitForSelector('#game-area:not(.hidden)');
  await bob.waitForSelector('#game-area:not(.hidden)');

  // 콘솔 메시지 조기 캡처 (버그 진단용)
  const aliceConsole: string[] = [];
  const bobConsole: string[] = [];
  alice.on('console', m => aliceConsole.push(`[${m.type()}] ${m.text()}`));
  bob.on('console',   m => bobConsole.push(`[${m.type()}] ${m.text()}`));

  // ── 4. 양쪽 베팅 — UI 클릭 대신 JS 직접 호출 ────────────────────────
  await alice.evaluate(() => {
    (document.getElementById('bet-amount') as HTMLInputElement).value = '500';
    (window as any).placeBet();
  });
  console.log('Alice 베팅 전송 완료');

  await alice.waitForTimeout(600);  // 서버 처리 대기

  await bob.evaluate(() => {
    (document.getElementById('bet-amount') as HTMLInputElement).value = '1000';
    (window as any).placeBet();
  });
  console.log('Bob 베팅 전송 완료');

  // 중간 상태 진단
  await alice.waitForTimeout(1500);
  const aliceState = await alice.evaluate(() => {
    const s = (window as any).S;
    return {
      phase: s?.gameState?.data?.phase,
      myUid: s?.uid,
      players: s?.gameState?.data?.players ? Object.keys(s.gameState.data.players) : [],
      dealerCards: s?.gameState?.data?.dealer?.hand?.length ?? 0,
    };
  });
  console.log('Alice 상태:', JSON.stringify(aliceState));

  // 카드가 나타날 때까지 대기
  await alice.waitForSelector('.card', { timeout: 12_000 }).catch(async () => {
    console.log('⚠️ 카드 미노출');
    console.log('Alice console 최근 5줄:', aliceConsole.slice(-5));
    const html = await alice.locator('#game-area').innerHTML();
    console.log('game-area innerHTML(앞 600자):', html.slice(0, 600));
    throw new Error('카드 미노출');
  });
  await bob.waitForSelector('.card', { timeout: 12_000 });

  // ── 5. Alice 턴 (action-phase 가 보일 때까지 대기 후 스탠드) ────────────
  await alice.waitForSelector('#action-phase:not(.hidden)', { timeout: 8_000 })
    .then(() => alice.evaluate(() => (window as any).gameAction('STAND')))
    .catch(() => console.log('Alice 액션 불필요 (이미 done)'));

  console.log('Alice 스탠드 전송');

  // ── 6. Bob 턴 ───────────────────────────────────────────────────────────
  await bob.waitForSelector('#action-phase:not(.hidden)', { timeout: 8_000 })
    .then(() => bob.evaluate(() => (window as any).gameAction('STAND')))
    .catch(() => console.log('Bob 액션 불필요 (이미 done)'));

  console.log('Bob 스탠드 전송');

  // ── 7. 라운드 결과 확인 ─────────────────────────────────────────────────
  // 딜러 애니메이션 후 인플레이스 결과가 dealer-area에 표시됨 (오버레이 없음)
  await alice.waitForSelector('#result-display:not(.hidden)', { timeout: 15_000 });
  const resultTitle = await alice.textContent('#result-title');
  console.log('Alice 결과:', resultTitle);

  expect(['🎉 승리!', '💀 패배', '🤝 무승부']).toContain(resultTitle?.trim());

  // 3초 카운트다운 후 result-display가 자동으로 사라짐
  await alice.waitForSelector('#result-display', { state: 'hidden', timeout: 8_000 });

  // ── 8. 채팅 테스트 ──────────────────────────────────────────────────────
  await alice.fill('#chat-input', '안녕 Bob!');
  await alice.press('#chat-input', 'Enter');

  // Bob이 메시지 수신 확인
  await bob.waitForSelector('.chat-msg:has-text("안녕 Bob!")');
  const chatMsg = await bob.textContent('.chat-msg:has-text("안녕 Bob!")');
  expect(chatMsg).toContain('안녕 Bob!');

  console.log('✅ 모든 시나리오 통과');

  await ctx1.close();
  await ctx2.close();
});

// 단독 테스트들
test('방 생성 → 게임 화면 진입', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#create-name', 'TestUser');
  await page.click('button:has-text("방 만들기")');
  await page.waitForSelector('#game-screen', { state: 'visible' });

  // #badge-rid 에는 room ID만 들어 있고, "방 ID:" 텍스트는 부모에 있음
  const badge = await page.textContent('#badge-rid');
  expect(badge).toBeTruthy();
  expect(badge).not.toBe('...');
});

test('잘못된 방 ID로 참가 시 에러', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#join-rid',  'invalid-room-id');
  await page.fill('#join-name', 'Ghost');
  await page.click('button:has-text("참가하기")');

  await page.waitForSelector('.toast');
  const toast = await page.textContent('.toast');
  expect(toast).toContain('실패');
});

test('PING-PONG WebSocket 확인', async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.fill('#create-name', 'PingUser');
  await page.click('button:has-text("방 만들기")');
  await page.waitForSelector('#conn-status:has-text("✅")');

  // 이벤트 로그에 PONG이 찍히도록 WebSocket 직접 호출
  await page.evaluate(() => (window as any).send({ action: 'PING' }));
  await page.waitForSelector('.ev-entry:has-text("PONG")');

  await ctx.close();
});
