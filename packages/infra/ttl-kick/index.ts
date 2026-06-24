import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { broadcastToRoom } from '../../backend/functions/websocket/broadcast';

const WS_CALLBACK = process.env.WS_CALLBACK_URL ?? '';

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  await Promise.allSettled(event.Records.map(processRecord));
};

async function processRecord(record: DynamoDBRecord): Promise<void> {
  // TTL 만료만 처리 (수동 삭제는 제외)
  if (record.eventName !== 'REMOVE') return;
  if (record.userIdentity?.type !== 'Service') return;

  const old = record.dynamodb?.OldImage;
  if (!old) return;

  const pk = old['pk']?.S ?? '';
  const sk = old['sk']?.S ?? '';

  // ROOM# 안의 PLAYER# 레코드만 처리
  if (!pk.startsWith('ROOM#') || !sk.startsWith('PLAYER#')) return;

  // 연결 끊김 상태였던 플레이어만 퇴장 처리
  if (old['status']?.S !== 'disconnected') return;

  const roomId = pk.slice(5);   // 'ROOM#' 제거
  const userId = old['userId']?.S ?? '';
  if (!userId || !WS_CALLBACK) return;

  console.log(`[ttl-kick] Removing ${userId} from room ${roomId}`);
  await broadcastToRoom(roomId, { type: 'PLAYER_LEFT', userId }, WS_CALLBACK);
}
