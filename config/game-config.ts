export const GameConfig = {
  room: {
    maxPlayers: 8,
    minPlayers: 2,
    startingBalance: 10_000,
    maxDurationMs: 30 * 60_000,
  },

  afk: {
    warningAfterMs: 60_000,
    penaltyAfterMs: 120_000,
    penaltyAmount: 500,
    checkIntervalMs: 30_000,
  },

  winCondition: {
    type: 'last-standing' as const,
    bankruptThreshold: 0,
  },

  games: {
    blackjack: {
      minBet: 100,
      maxBet: 5_000,
      decks: 6,
      dealerStandsOn: 17,
      blackjackPayout: 1.5,
    },
    roulette: {
      minBet: 50,
      maxBet: 2_000,
      bettingPhaseMs: 30_000,
      payouts: {
        straight: 35,      // 단일 숫자 (35:1)
        split: 17,         // 2개 숫자 (17:1)
        street: 11,        // 3개 숫자 줄 (11:1)
        corner: 8,         // 4개 숫자 코너 (8:1)
        sixLine: 5,        // 6개 숫자 2줄 (5:1)
        column: 2,         // 열 베팅 (2:1)
        dozen: 2,          // 다즌 베팅 (2:1)
        evenMoney: 1,      // 짝/홀, 빨강/검정, 높낮이 (1:1)
      },
    },
    baccarat: {
      minBet: 200,
      maxBet: 5_000,
      decks: 8,
      bankerCommission: 0.05,  // 뱅커 승 시 5% 커미션 → 실질 페이아웃 0.95:1
      payouts: {
        player: 1,             // 플레이어 승 (1:1)
        banker: 0.95,          // 뱅커 승 (0.95:1, 커미션 차감)
        tie: 8,                // 타이 (8:1)
      },
    },
    slots: {
      minBet: 10,
      maxBet: 1_000,
      reels: 5,
      symbols: ['🍒', '🍋', '🍊', '⭐', '💎', '7️⃣'] as const,
      payouts: {
        // 5릴 기준 일치 개수별 배당 (베팅 대비 순이익 배수)
        match5: 100,  // 잭팟: 5개 일치
        match4: 20,   // 4개 일치
        match3: 5,    // 3개 일치
        match2: 1,    // 2개 일치 (베팅 반환 수준)
      },
    },
    hiLo: {
      minBet: 50,
      maxBet: 3_000,
      decks: 1,
      payouts: {
        correct: 1,   // 예측 성공 (1:1)
      },
      /** 한 라운드에서 연속으로 예측할 수 있는 최대 횟수 */
      maxStreak: 8,
    },
    war: {
      minBet: 100,
      maxBet: 2_000,
      decks: 1,
      payouts: {
        win: 1,       // 일반 승리 (1:1)
        war: 1,       // 전쟁(타이 후 재승부) 승리 (1:1)
        surrender: -0.5, // 전쟁 포기: 베팅의 절반 손실
        tie: 10,      // 전쟁 승부에서 타이 (10:1 보너스)
      },
    },
  },
} as const;

export type GameId = keyof typeof GameConfig.games;
