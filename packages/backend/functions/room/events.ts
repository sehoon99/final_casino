import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eb = new EventBridgeClient({});
const BUS = process.env.EVENT_BUS_NAME!;

export type RoomEventType =
  | 'ROOM_CREATED'
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'PLAYER_BANKRUPT';

export async function publishEvent(
  type: RoomEventType,
  detail: Record<string, unknown>,
): Promise<void> {
  // 로컬 개발 환경에서는 EventBridge 없이 콘솔 로그로 대체
  if (process.env.USE_LOCAL_WS) {
    console.log(`[EventBridge] ${type}`, detail);
    return;
  }
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'casino.room',
      DetailType: type,
      Detail: JSON.stringify(detail),
    }],
  }));
}
