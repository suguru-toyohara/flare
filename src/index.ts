import dotenv from 'dotenv';
import { DiscordGateway } from './discord-gateway';

dotenv.config();

// 使用例
const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is not set in environment variables');
}

const gateway = new DiscordGateway(token);
gateway.connect().catch(console.error);

// プロセス終了時の適切なクリーンアップ
process.on('SIGINT', () => {
  console.log('Shutting down...');
  gateway.disconnect();
  process.exit(0);
});
