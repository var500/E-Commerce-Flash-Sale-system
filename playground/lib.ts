import "dotenv/config";
import { connect, ChannelModel, Channel } from "amqplib";

const url = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

export async function openChannel(): Promise<{
  connection: ChannelModel;
  channel: Channel;
}> {
  const connection = await connect(url);
  const channel = await connection.createChannel();

  process.once("SIGINT", async () => {
    console.log("\nClosing...");
    await connection.close().catch(() => {});
    process.exit(0);
  });

  return { connection, channel };
}

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
