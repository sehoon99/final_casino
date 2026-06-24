import { QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db';

export async function deleteRoom(roomId: string): Promise<void> {
  const pk = `ROOM#${roomId}`;
  const keys: Array<{ pk: string; sk: string }> = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: lastKey,
    }));
    for (const item of res.Items ?? []) {
      keys.push({ pk: item.pk as string, sk: item.sk as string });
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // DynamoDB BatchWrite: max 25 items per request
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: keys.slice(i, i + 25).map(k => ({ DeleteRequest: { Key: k } })),
      },
    }));
  }
}
