import { openChannel } from "./lib";

async function main() {
  const [type = "fanout", ...bindingKeys] = process.argv.slice(2);
  const exchange = `playground.${type}`;

  const { channel } = await openChannel();
  await channel.assertExchange(exchange, type, { durable: false });

  const { queue } = await channel.assertQueue("", { exclusive: true });

  const keys = type === "fanout" ? [""] : bindingKeys;
  if (keys.length === 0) {
    throw new Error("Give at least one binding key, e.g. order.created");
  }

  for (const key of keys) {
    await channel.bindQueue(queue, exchange, key);
  }

  console.log(`[*] ${queue} bound to ${exchange} with [${keys.join(", ")}]`);

  await channel.consume(
    queue,
    (msg) => {
      if (!msg) return;
      console.log(
        `[x] key="${msg.fields.routingKey}" "${msg.content.toString()}"`,
      );
    },
    { noAck: true },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
