import WebSocket from 'ws';
import { setTimeout } from 'timers/promises';

// Discord Gateway APIのバージョンとエンドポイント
const DISCORD_GATEWAY_VERSION = '10';
const DISCORD_GATEWAY_URL = `wss://gateway.discord.gg/?v=${DISCORD_GATEWAY_VERSION}&encoding=json`;

// OPコード定義
export enum OpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  PRESENCE_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  REQUEST_GUILD_MEMBERS = 8,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/**
 * Discord Gateway APIとの WebSocket 通信を管理するクラス
 * WebSocketを使用してDiscordのリアルタイムイベントを処理する
 */
export class DiscordGateway {
  private ws: WebSocket | null = null;
  private sequence: number | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(private readonly token: string) {}

  /**
   * Discord Gateway APIへの接続を確立する
   * WebSocketコネクションを初期化し、イベントハンドラを設定する
   */
  public async connect(): Promise<void> {
    try {
      this.ws = new WebSocket(DISCORD_GATEWAY_URL);
      this.setupWebSocketHandlers();
    } catch (error) {
      console.error('Failed to connect to Discord Gateway:', error);
      await this.handleReconnect();
    }
  }

  /**
   * WebSocketイベントハンドラを設定する
   * open, message, error, closeイベントに対するハンドラを登録する
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log('Connected to Discord Gateway');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const payload = JSON.parse(data.toString());
        this.handlePayload(payload);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.ws.on('close', async (code, reason) => {
      console.log(`Connection closed: ${code} - ${reason}`);
      await this.handleReconnect();
    });
  }

  /**
   * Discord Gatewayから受信したペイロードを処理する
   * 各種オペコードに応じて適切なハンドラを呼び出す
   * @param payload 受信したペイロードデータ
   */
  private async handlePayload(payload: any): Promise<void> {
    const { op, d, s, t } = payload;

    // シーケンス番号の更新
    if (s !== null) {
      this.sequence = s;
    }

    switch (op) {
      case OpCode.HELLO:
        await this.handleHello(d);
        break;
      case OpCode.HEARTBEAT_ACK:
        console.log('Received heartbeat acknowledgement');
        break;
      case OpCode.INVALID_SESSION:
        console.log('Session invalidated');
        await this.handleInvalidSession();
        break;
      case OpCode.DISPATCH:
        this.handleDispatch(t, d);
        break;
      default:
        console.log(`Unhandled op code: ${op}`);
    }
  }

  /**
   * HELLO オペコードの処理を行う
   * ハートビートの開始とIdentify処理を実行する
   * @param data HELLOイベントのデータ
   */
  private async handleHello(data: any): Promise<void> {
    const { heartbeat_interval } = data;
    this.startHeartbeat(heartbeat_interval);
    await this.identify();
  }

  /**
   * セッション無効化の処理を行う
   * ハートビートを停止し、再接続を試みる
   */
  private async handleInvalidSession(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    await setTimeout(5000);
    await this.connect();
  }

  /**
   * DISPATCHイベントの処理を行う
   * 各種イベントタイプに応じた処理を実行する
   * @param event イベントタイプ
   * @param data イベントデータ
   */
  private handleDispatch(event: string, data: any): void {
    switch (event) {
      case 'READY':
        this.sessionId = data.session_id;
        console.log('Bot is ready!');
        break;
      default:
        console.log(`Received dispatch event: ${event}`);
    }
  }

  /**
   * ハートビートの送信を開始する
   * 指定された間隔でハートビートを送信する
   * @param interval ハートビートの送信間隔（ミリ秒）
   */
  private startHeartbeat(interval: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  /**
   * ハートビートを送信する
   * 現在のシーケンス番号を含むハートビートペイロードを送信する
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      op: OpCode.HEARTBEAT,
      d: this.sequence,
    };

    this.ws.send(JSON.stringify(payload));
    console.log('Heartbeat sent');
  }

  /**
   * Identify情報を送信する
   * ボットのトークンやインテント情報を含むIdentifyペイロードを送信する
   */
  private async identify(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      op: OpCode.IDENTIFY,
      d: {
        token: this.token,
        intents: 513, // GUILDSとGUILD_MESSAGESのintents
        properties: {
          os: process.platform,
          browser: 'discord_gateway',
          device: 'discord_gateway',
        },
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * 再接続処理を行う
   * 指数バックオフを使用して再接続を試みる
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`Attempting to reconnect in ${delay}ms...`);
    
    await setTimeout(delay);
    await this.connect();
  }

  /**
   * Gateway接続を切断する
   * ハートビートを停止し、WebSocket接続を閉じる
   */
  public disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
