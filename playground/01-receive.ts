import { openChannel } from "./lib";

const QUEUE = "hello";

async function main() {
  const { channel } = await openChannel();
  await channel.assertQueue(QUEUE, { durable: false });

  console.log(`[*] Waiting for messages in "${QUEUE}". Ctrl+C to exit`);

  await channel.consume(
    QUEUE,
    (msg) => {
      if (!msg) return; // server cancelled the consumer (e.g. queue deleted)
      console.log(`[x] Received "${msg.content.toString()}"`);
    },
    { noAck: true }, // auto-ack: message is "done" the moment it's delivered
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
