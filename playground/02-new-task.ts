import { openChannel, getArg } from "./lib";

const QUEUE = "tasks";

async function main() {
  const count = Number(getArg("count", "10"));
  const pattern = getArg("pattern", "even"); // even | alternating

  const { connection, channel } = await openChannel();

  await channel.assertQueue(QUEUE, { durable: true });

  for (let i = 0; i <= count; i++) {
    const durationMs =
      pattern === "alternating" ? (i % 2 === 1 ? 5000 : 500) : 1000;
    const task = { id: i, durationMs };

    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(task)), {
      persistent: true,
    });
    console.log(`[x] Sent task ${i} (${durationMs}ms)`);
  }

  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
