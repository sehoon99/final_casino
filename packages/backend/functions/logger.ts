type Level = 'INFO' | 'WARN' | 'ERROR' | 'METRIC';

export type MetricEvent =
  | 'session_start'     // 신규 WebSocket 접속
  | 'session_reconnect' // 재접속
  | 'session_end'       // 접속 종료
  | 'room_create'       // 방 생성
  | 'room_destroy'      // 방 삭제 (폭파/정리/비워짐)
  | 'game_start'        // 게임 라운드 시작
  | 'game_end';         // 게임 라운드 종료

interface LogContext {
  userId?:      string;
  roomId?:      string;
  action?:      string;
  gameId?:      string;
  connId?:      string;
  sessionSec?:  number;
  playerCount?: number;
  country?:     string;
  countryCode?: string;
  timezone?:    string;
  sourceIp?:    string;
  reason?:      string;
  [key: string]: unknown;
}

function log(level: Level, message: string, ctx: LogContext = {}, err?: unknown) {
  const entry: Record<string, unknown> = {
    level,
    message,
    ts: Date.now(),
    fn: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
    ...ctx,
  };
  if (err instanceof Error) {
    entry.error     = err.message;
    entry.errorType = err.name;
    entry.stack     = err.stack?.split('\n').slice(0, 4).join(' | ');
  } else if (err != null) {
    entry.error = String(err);
  }
  console.log(JSON.stringify(entry));
}

export const logger = {
  info:   (msg: string, ctx?: LogContext)                => log('INFO',   msg, ctx),
  warn:   (msg: string, ctx?: LogContext)                => log('WARN',   msg, ctx),
  error:  (msg: string, ctx?: LogContext, err?: unknown) => log('ERROR',  msg, ctx, err),
  metric: (event: MetricEvent, ctx?: LogContext)         => log('METRIC', event, ctx),
};

// IP 기반 국가/시간대 조회 (ip-api.com 무료, API 키 불필요)
interface GeoInfo {
  country:     string;
  countryCode: string;
  timezone:    string;
  city:        string;
}

export async function fetchGeo(ip: string | undefined): Promise<GeoInfo | null> {
  if (!ip || ip === '127.0.0.1' || ip.startsWith('::')) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,timezone,city`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    const d = await res.json() as { status: string } & GeoInfo;
    return d.status === 'success' ? d : null;
  } catch {
    return null;
  }
}
