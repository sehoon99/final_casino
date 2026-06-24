import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

// Cost Explorer endpoint is us-east-1 only (global service)
const ce = new CostExplorerClient({ region: 'us-east-1' });

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const token = _event.headers?.['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const today = new Date();
    // End date is exclusive in Cost Explorer — use tomorrow
    const endDate = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
    // Start of current month
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

    const res = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    }));

    const daily = (res.ResultsByTime ?? []).map(r => ({
      date: r.TimePeriod?.Start ?? '',
      amount: parseFloat(parseFloat(r.Total?.UnblendedCost?.Amount ?? '0').toFixed(4)),
    }));

    const total = parseFloat(daily.reduce((s, d) => s + d.amount, 0).toFixed(4));
    const todayAmount = daily.length > 0 ? daily[daily.length - 1].amount : 0;

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ daily, total, today: todayAmount, currency: 'USD', fetchedAt: Date.now() }),
    };
  } catch (err) {
    console.error('[costs]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
