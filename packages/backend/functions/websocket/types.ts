export interface WsEvent {
  requestContext: {
    connectionId: string;
    routeKey: '$connect' | '$disconnect' | '$default';
    stage: string;
    domainName: string;
    identity?: { sourceIp?: string };
  };
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
}

export type WsHandler = (event: WsEvent) => Promise<{ statusCode: number }>;
