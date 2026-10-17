import { openChannel } from "./lib";

const setups = [
  { queue: "durability.transient", durable: false, persistent: false },
  { queue: "durability.durable-queue-only", durable: true, persistent: false },
  { queue: "durability.fully-durable", durable: true, persistent: true },
];

async function main() {
  const { connection, channel } = await openChannel();

  for (const { queue, durable, persistent } of setups) {
    await channel.assertQueue(queue, { durable });
    for (let i = 1; i <= 5; i++) {
      channel.sendToQueue(queue, Buffer.from(`msg ${i}`), { persistent });
    }
    console.log(
      `[x] 5 messages -> ${queue} (durable=${durable}, persistent=${persistent})`,
    );
  }

  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
