import * as zlib from 'zlib';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL!;

interface CwLogsEvent {
  awslogs: { data: string };
}

interface StructuredLog {
  level?: string;
  message?: string;
  error?: string;
  errorType?: string;
  userId?: string;
  roomId?: string;
  action?: string;
  gameId?: string;
  fn?: string;
  ts?: number;
  [key: string]: unknown;
}

function parseLog(raw: string): StructuredLog | null {
  try {
    return JSON.parse(raw) as StructuredLog;
  } catch {
    return null;
  }
}

function isError(raw: string, parsed: StructuredLog | null): boolean {
  if (parsed?.level === 'ERROR') return true;
  return /\bERROR\b|\bUnhandledPromiseRejection\b|\bTask timed out\b/.test(raw);
}

function formatField(parsed: StructuredLog | null, raw: string): { title: string; body: string; context: string } {
  if (!parsed) {
    return {
      title: raw.slice(0, 100),
      body:  raw.slice(0, 500),
      context: '',
    };
  }

  const ctx: string[] = [];
  if (parsed.userId)  ctx.push(`👤 \`${parsed.userId}\``);
  if (parsed.roomId)  ctx.push(`🏠 \`${parsed.roomId}\``);
  if (parsed.action)  ctx.push(`⚡ \`${parsed.action}\``);
  if (parsed.gameId)  ctx.push(`🎮 \`${parsed.gameId}\``);

  const errorDetail = [parsed.message, parsed.error].filter(Boolean).join(' — ');

  return {
    title:   errorDetail.slice(0, 100) || '에러 발생',
    body:    parsed.error ?? parsed.message ?? raw.slice(0, 300),
    context: ctx.join('  '),
  };
}

export const handler = async (event: CwLogsEvent) => {
  if (!WEBHOOK) return;

  const raw = Buffer.from(event.awslogs.data, 'base64');
  const data = JSON.parse(zlib.gunzipSync(raw).toString()) as {
    logGroup: string;
    logEvents: { timestamp: number; message: string }[];
  };

  const errors = data.logEvents.filter(e => {
    const parsed = parseLog(e.message);
    return isError(e.message, parsed);
  });

  if (errors.length === 0) return;

  const fn = data.logGroup.replace('/aws/lambda/', '');

  // 에러마다 파싱해서 가장 상세한 첫 번째 에러로 Discord embed 구성
  const firstParsed = parseLog(errors[0].message);
  const { title, body, context } = formatField(firstParsed, errors[0].message);

  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (context) fields.push({ name: '컨텍스트', value: context, inline: false });
  if (errors.length > 1) {
    const extras = errors.slice(1, 3).map(e => {
      const p = parseLog(e.message);
      return p?.message ?? e.message.slice(0, 150);
    }).join('\n');
    fields.push({ name: `+${errors.length - 1}개 추가 에러`, value: extras, inline: false });
  }

  const discordBody = JSON.stringify({
    embeds: [{
      title:       `🚨 [${fn}] ${title}`,
      color:       15158332,
      description: `\`\`\`\n${body.slice(0, 800)}\n\`\`\``,
      fields,
      timestamp:   new Date(errors[0].timestamp).toISOString(),
    }],
  });

  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: discordBody,
  });
};
