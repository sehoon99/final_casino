# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: casino.spec.ts >> PING-PONG WebSocket 확인
- Location: tests\casino.spec.ts:155:1

# Error details

```
Test timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]: 🎰 Casino Night
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "방 만들기" [level=2] [ref=e6]
      - textbox "닉네임" [ref=e7]: PingUser
      - spinbutton [ref=e8]: "4"
      - button "방 만들기" [active] [ref=e9] [cursor=pointer]
    - generic [ref=e10]:
      - heading "방 참가하기" [level=2] [ref=e11]
      - textbox "방 ID (붙여넣기)" [ref=e12]
      - textbox "닉네임" [ref=e13]
      - button "참가하기" [ref=e14] [cursor=pointer]
```