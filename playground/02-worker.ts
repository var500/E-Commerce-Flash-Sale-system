import { openChannel, getArg, sleep } from "./lib";

const QUEUE = "tasks";

type Task = { id: number; durationMs: number };

async function main() {
  const name = getArg("name", `worker-${process.pid}`);
  const ackMode = getArg("ack", "manual");
  const prefetch = Number(getArg("prefetch", "0"));
  const crashAfter = Number(getArg("crash-after", "0"));

  const { channel } = await openChannel();
  await channel.assertQueue(QUEUE, { durable: true });

  if (prefetch > 0) {
    // Max number of unacked messages RabbitMQ will push to this consumer
    await channel.prefetch(prefetch);
  }

  console.log(
    `[${name}] ack=${ackMode} prefetch=${prefetch || "unlimited"} crash-after=${crashAfter || "never"}`,
  );

  let started = 0;
  let finished = 0;

  await channel.consume(
    QUEUE,
    async (msg) => {
      if (!msg) return;

      const task: Task = JSON.parse(msg.content.toString());
      const taskNumber = ++started;

      const redelivered = msg.fields.redelivered ? "(REDELIVERED)" : "";
      console.log(`[${name}] started task ${task.id}${redelivered}`);
      await sleep(task.durationMs / 2);

      if (crashAfter > 0 && taskNumber === crashAfter) {
        console.log(`[${name}] CRASH while working on task ${task.id}`);
      }

      await sleep(task.durationMs / 2);
      finished++;

      if (ackMode === "manual") {
        channel.ack(msg);
      }
    },
    { noAck: ackMode === "auto" },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
