import { openChannel } from "./lib";

const QUEUE = "hello";

async function main() {
  const { connection, channel } = await openChannel();

  await channel.assertQueue(QUEUE, { durable: false });
  const text = process.argv[2] ?? "Hello RabbitMQ!";
  channel.sendToQueue(QUEUE, Buffer.from(text));
  console.log("[x] Sent %s", text);

  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
