import { connect, ChannelModel, Channel } from "amqplib";
import { env } from "./env";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbit(): Promise<void> {
  connection = await connect(env.rabbitMQUrl);

  connection.on("error", (err) => {
    console.error("[rabbitmq] connection error", err.message);
  });

  connection.on("close", () => {
    console.warn("[rabbitmq] connection closed");
    connection = null;
    channel = null;
  });

  channel = await connection.createChannel();
  console.log("[rabbitmq] connected");
}

export function getChannel(): Channel {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialised");
  }
  return channel;
}

export async function checkRabbit(): Promise<void> {
  if (!connection) {
    throw new Error("not connected");
  }
  const testChannel = await connection.createChannel();
  await testChannel.close();
}

export async function closeRabbit(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
  console.log("[rabbitmq] closed");
}
