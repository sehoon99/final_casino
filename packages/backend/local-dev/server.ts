/**
 * 로컬 개발 서버
 * - WebSocket :3001  → API Gateway WebSocket 시뮬레이션
 * - HTTP      :3000  → REST 엔드포인트 (방 생성/참가/나가기)
 *
 * 사전 조건: Docker Desktop 실행 후 → docker-compose up -d
 * 실행:      npx tsx packages/backend/local-dev/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// 룸별 game action 직렬화 mutex — 로컬 개발 전용
// (프로덕션: Lambda는 인스턴스별 독립 실행이므로 DDB Conditional Write로 처리)
const roomActionQueue = new Map<string, Promise<unknown>>();
function serialized(roomId: string, fn: () => Promise<unknown>): Promise<unknown> {
  const prev = roomActionQueue.get(roomId) ?? Promise.resolve();
  const next = prev.then(fn, fn);  // 에러 있어도 큐 진행
  roomActionQueue.set(roomId, next.finally(() => {
    if (roomActionQueue.get(roomId) === next) roomActionQueue.delete(roomId);
  }));
  return next;
}
import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';

// ── 환경변수 설정 (핸들러 import 전에 먼저) ────────────────────────────────
const TABLE_NAME = 'casino-local';
process.env.TABLE_NAME = TABLE_NAME;
process.env.USE_LOCAL_WS = 'true';
process.env.AWS_ENDPOINT_URL = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';

// ── 로컬 WebSocket 레지스트리 (broadcast.ts가 참조) ──────────────────────
const wsConnections = new Map<string, WebSocket>();
(global as Record<string, unknown>).__localWsConnections = wsConnections;

// ── DynamoDB 테이블 초기화 (Docker 없으면 in-memory 폴백) ────────────────
async function initDb(): Promise<void> {
  const client = new DynamoDBClient({
    endpoint: 'http://localhost:8000',
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  try {
    const { TableNames } = await client.send(new ListTablesCommand({}));
    if (TableNames?.includes(TABLE_NAME)) {
      console.log('✅ DynamoDB table already exists:', TABLE_NAME);
      return;
    }
    await client.send(new CreateTableCommand({
      TableName: TABLE_NAME,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    console.log('✅ DynamoDB table created:', TABLE_NAME);
  } catch {
    // Docker 없으면 in-memory DynamoDB로 폴백
    console.warn('⚠️  DynamoDB Local 연결 실패 → in-memory 모드로 실행');
    process.env.AWS_ENDPOINT_URL = 'http://localhost:8001'; // 존재하지 않는 포트
    await startInMemoryDb();
  }
}

// ── In-memory DynamoDB (Docker 없을 때 테스트 전용) ──────────────────────
async function startInMemoryDb(): Promise<void> {
  type Row = Record<string, unknown>;
  const tables = new Map<string, Map<string, Row>>();

  const tbl = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const key = (pk: string, sk: string) => `${pk}\x00${sk}`;

  function applyUpdate(row: Row, expr: string, vals: Record<string, unknown>, names: Record<string, string>) {
    const field = (raw: string) => names[raw] ?? raw;

    // SET clause
    const setM = expr.match(/SET\s+(.+?)(?=\s+REMOVE|$)/is);
    if (setM) {
      for (const part of setM[1].split(',')) {
        const eqIdx = part.indexOf('=');
        const lhs = part.slice(0, eqIdx).trim();
        const rhs = part.slice(eqIdx + 1).trim();
        const f = field(lhs);
        // field = :val
        if (/^:[a-z_]+$/i.test(rhs)) {
          row[f] = vals[rhs];
        } else {
          // field = srcField +/- :val
          const arith = rhs.match(/^([\w#]+)\s*([+-])\s*(:[a-z_]+)$/i);
          if (arith) {
            const src = field(arith[1]);
            const delta = vals[arith[3]] as number;
            row[f] = ((row[src] as number) ?? 0) + (arith[2] === '+' ? delta : -delta);
          }
        }
      }
    }
    // REMOVE clause
    const rmM = expr.match(/REMOVE\s+(.+)/i);
    if (rmM) {
      for (const raw of rmM[1].split(',')) delete row[field(raw.trim())];
    }
  }

  type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
  const send = async (cmd: unknown): Promise<unknown> => {
    const c = cmd as Cmd;
    const t = c.input.TableName ? tbl(c.input.TableName as string) : new Map<string, Row>();
    switch (c.constructor.name) {
      case 'GetCommand': {
        const k = c.input.Key as Record<string, string>;
        return { Item: t.get(key(k.pk, k.sk)) ? { ...t.get(key(k.pk, k.sk)) } : undefined };
      }
      case 'PutCommand': {
        const i = c.input.Item as Row;
        t.set(key(i.pk as string, i.sk as string), { ...i });
        return {};
      }
      case 'DeleteCommand': {
        const k = c.input.Key as Record<string, string>;
        t.delete(key(k.pk, k.sk));
        return {};
      }
      case 'UpdateCommand': {
        const k = c.input.Key as Record<string, string>;
        const mapKey = key(k.pk, k.sk);
        const row: Row = { ...(t.get(mapKey) ?? k) };
        applyUpdate(row, c.input.UpdateExpression as string ?? '',
          c.input.ExpressionAttributeValues as Record<string, unknown> ?? {},
          c.input.ExpressionAttributeNames as Record<string, string> ?? {});
        t.set(mapKey, row);
        return {};
      }
      case 'QueryCommand': {
        const ev = c.input.ExpressionAttributeValues as Record<string, string>;
        const pk = ev[':pk']; const prefix = ev[':prefix'] ?? '';
        const items: Row[] = [];
        for (const [k, v] of t) {
          const [kpk, ksk] = k.split('\x00');
          if (kpk === pk && ksk.startsWith(prefix)) items.push({ ...v });
        }
        return { Items: items };
      }
      case 'TransactWriteCommand': {
        type TxItem = {
          Put?: { TableName: string; Item: Row };
          Delete?: { TableName: string; Key: Record<string, string> };
          Update?: { TableName: string; Key: Record<string, string>; UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown>; ExpressionAttributeNames?: Record<string, string> };
        };
        for (const item of c.input.TransactItems as TxItem[]) {
          if (item.Put) {
            const t2 = tbl(item.Put.TableName); const i = item.Put.Item;
            t2.set(key(i.pk as string, i.sk as string), { ...i });
          } else if (item.Delete) {
            tbl(item.Delete.TableName).delete(key(item.Delete.Key.pk, item.Delete.Key.sk));
          } else if (item.Update) {
            const u = item.Update; const t2 = tbl(u.TableName);
            const mapKey = key(u.Key.pk, u.Key.sk);
            const row: Row = { ...(t2.get(mapKey) ?? u.Key) };
            applyUpdate(row, u.UpdateExpression, u.ExpressionAttributeValues, u.ExpressionAttributeNames ?? {});
            t2.set(mapKey, row);
          }
        }
        return {};
      }
      case 'ScanCommand': {
        const items: Row[] = [];
        for (const [, v] of t) items.push({ ...v });
        return { Items: items };
      }
      default: return {};
    }
  };

  // db.ts의 ddb 인스턴스 send 메서드를 패치 (loadHandlers 이전에 실행됨)
  const dbModule = await import('../functions/room/db.ts');
  (dbModule.ddb as unknown as { send: typeof send }).send = send;
  console.log('✅ In-memory DynamoDB 활성화 (테스트 전용 — Docker 없이 동작)');
}

// 1분 재연결 대기 타이머: `userId:roomId` → timer
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── 핸들러 로드 (환경변수 설정 후) ──────────────────────────────────────
async function loadHandlers() {
  const [
    { handler: connectHandler },
    { handler: disconnectHandler },
    { handler: defaultHandler },
    { handler: createHandler },
    { handler: joinHandler },
    { handler: leaveHandler },
    { broadcastToRoom },
  ] = await Promise.all([
    import('../functions/websocket/connect.ts'),
    import('../functions/websocket/disconnect.ts'),
    import('../functions/websocket/default.ts'),
    import('../functions/room/create.ts'),
    import('../functions/room/join.ts'),
    import('../functions/room/leave.ts'),
    import('../functions/websocket/broadcast.ts'),
  ]);
  return { connectHandler, disconnectHandler, defaultHandler, createHandler, joinHandler, leaveHandler, broadcastToRoom };
}

// ── 유틸: request body 읽기 ───────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
  });
}

// ── mock API Gateway 이벤트 생성 ─────────────────────────────────────────
function mockRestEvent(body: string, pathParameters: Record<string, string> = {}) {
  return { body, pathParameters, queryStringParameters: {} } as never;
}

function mockWsEvent(
  connectionId: string,
  routeKey: '$connect' | '$disconnect' | '$default',
  body: string | null,
  queryStringParameters: Record<string, string>,
) {
  return {
    requestContext: { connectionId, routeKey, stage: 'local', domainName: 'localhost' },
    queryStringParameters,
    body,
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────────
async function main() {
  try {
    await initDb();
  } catch {
    console.error('❌ DynamoDB 연결 실패. Docker Desktop 켜고 docker-compose up -d 를 먼저 실행하세요.');
    process.exit(1);
  }

  const handlers = await loadHandlers();

  // ── HTTP 서버 (REST) ──────────────────────────────────────────────────
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = await readBody(req);

    const send = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    try {
      let result: { statusCode: number; body: string };

      if (req.method === 'POST' && url.pathname === '/rooms') {
        result = await handlers.createHandler(mockRestEvent(body)) as never;

      } else if (req.method === 'POST' && url.pathname.match(/^\/rooms\/[^/]+\/join$/)) {
        const roomId = url.pathname.split('/')[2];
        result = await handlers.joinHandler(mockRestEvent(body, { roomId })) as never;

      } else if (req.method === 'POST' && url.pathname.match(/^\/rooms\/[^/]+\/leave$/)) {
        const roomId = url.pathname.split('/')[2];
        result = await handlers.leaveHandler(mockRestEvent(body, { roomId })) as never;

      } else if (req.method === 'GET' && url.pathname === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end('window.__CASINO_CONFIG__ = { api: "http://localhost:3000", ws: "ws://localhost:3001" };');

      } else if (req.method === 'GET' && url.pathname === '/') {
        const html = await import('fs').then(fs =>
          fs.promises.readFile(new URL('../../../test-ui.html', import.meta.url), 'utf-8')
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);

      } else {
        return send(404, { error: 'Not found' });
      }

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });

  httpServer.listen(3000, () => {
    console.log('🌐 HTTP  server → http://localhost:3000');
  });

  // ── WebSocket 서버 ────────────────────────────────────────────────────
  const wss = new WebSocketServer({ port: 3001 });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const connectionId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    wsConnections.set(connectionId, ws);

    const url = new URL(req.url ?? '/', 'http://localhost');
    const qs: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { qs[k] = v; });

    // 재연결이면 킥 타이머 취소
    if (qs.userId && qs.roomId) {
      const key = `${qs.userId}:${qs.roomId}`;
      const pending = disconnectTimers.get(key);
      if (pending) {
        clearTimeout(pending);
        disconnectTimers.delete(key);
        console.log(`[reconnect] ${qs.userId} back in room ${qs.roomId}`);
      }
    }

    console.log(`[+] connect  ${connectionId}`, qs);

    const connectResult = await handlers.connectHandler(mockWsEvent(connectionId, '$connect', null, qs));
    if (connectResult.statusCode !== 200) {
      ws.close(1008, 'userId and roomId required');
      return;
    }

    ws.send(JSON.stringify({ type: 'CONNECTED', connectionId }));

    ws.on('message', async (data: Buffer) => {
      const body = data.toString();
      console.log(`[>] ${connectionId}: ${body}`);
      let action: string | undefined;
      try { action = JSON.parse(body).action; } catch { /* ignore */ }

      if (action === 'GAME_ACTION' || action === 'START_GAME') {
        // 게임 상태 변경은 룸별 직렬화 (stale read 방지)
        await serialized(qs.roomId, () => handlers.defaultHandler(mockWsEvent(connectionId, '$default', body, qs)));
      } else {
        await handlers.defaultHandler(mockWsEvent(connectionId, '$default', body, qs));
      }
    });

    ws.on('close', async () => {
      console.log(`[-] disconnect ${connectionId}`);
      wsConnections.delete(connectionId);
      await handlers.disconnectHandler(mockWsEvent(connectionId, '$disconnect', null, qs));

      // 60초 안에 재연결 없으면 자동 퇴장
      if (qs.userId && qs.roomId) {
        const key = `${qs.userId}:${qs.roomId}`;
        clearTimeout(disconnectTimers.get(key));
        const timer = setTimeout(async () => {
          disconnectTimers.delete(key);
          console.log(`[kick] ${qs.userId} removed from ${qs.roomId} (60s no reconnect)`);
          try {
            await handlers.leaveHandler(mockRestEvent(
              JSON.stringify({ userId: qs.userId }),
              { roomId: qs.roomId },
            ));
            await handlers.broadcastToRoom(qs.roomId, {
              type: 'PLAYER_LEFT',
              userId: qs.userId,
            }, 'http://localhost:3001');
          } catch (err) {
            console.error('[kick-timer]', err);
          }
        }, 60_000);
        disconnectTimers.set(key, timer);
      }
    });

    ws.on('error', (err) => console.error(`[!] ws error ${connectionId}:`, err));
  });

  wss.on('listening', () => {
    console.log('🔌 WebSocket server → ws://localhost:3001');
    console.log('\n사용법:');
    console.log('  # 방 생성');
    console.log('  curl -X POST http://localhost:3000/rooms -H "Content-Type: application/json" \\');
    console.log('       -d \'{"hostId":"user1","hostName":"Alice","maxPlayers":4}\'');
    console.log('\n  # WebSocket 연결 (wscat 사용)');
    console.log('  wscat -c "ws://localhost:3001?userId=user1&roomId=<roomId>&userName=Alice"');
    console.log('\n  # 메시지 예시');
    console.log('  {"action":"PING"}');
    console.log('  {"action":"CHAT","payload":"안녕!"}');
    console.log('  {"action":"START_GAME","payload":{"gameId":"blackjack"}}');
    console.log('  {"action":"GAME_ACTION","payload":{"type":"BET","payload":500}}');
  });
}

main().catch((err) => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
