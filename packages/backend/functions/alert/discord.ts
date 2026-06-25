import * as zlib from 'zlib';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL!;

interface CwLogsEvent {
  awslogs: { data: string };
}

export const handler = async (event: CwLogsEvent) => {
  if (!WEBHOOK) return;

  const raw = Buffer.from(event.awslogs.data, 'base64');
  const data = JSON.parse(zlib.gunzipSync(raw).toString()) as {
    logGroup: string;
    logEvents: { timestamp: number; message: string }[];
  };

  const errors = data.logEvents.filter(e =>
    /\bERROR\b|\bUnhandledPromiseRejection\b|\bTask timed out\b/.test(e.message)
  );
  if (errors.length === 0) return;

  const fn = data.logGroup.replace('/aws/lambda/', '');
  const snippet = errors
    .slice(0, 3)
    .map(e => e.message.replace(/\t/g, ' ').slice(0, 280))
    .join('\n');

  const body = JSON.stringify({
    embeds: [{
      title: `🚨 Lambda 오류: ${fn}`,
      color: 15158332,
      description: `\`\`\`\n${snippet}\n\`\`\``,
      timestamp: new Date(errors[0].timestamp).toISOString(),
    }],
  });

  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
};
