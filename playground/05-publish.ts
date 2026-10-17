import { openChannel } from "./lib";

const TYPES = ["fanout", "direct", "topic"];

async function main() {
  const [type = "fanout", routingKey = "", ...words] = process.argv.slice(2);
  if (!TYPES.includes(type)) {
    throw new Error(`type must be of: ${TYPES.join(", ")}`);
  }

  const exchange = `playground.${type}`;
  const { connection, channel } = await openChannel();
  await channel.assertExchange(exchange, type, { durable: false });

  const message = words.join("") || `hello at ${new Date().toISOString()}`;
  channel.publish(exchange, routingKey, Buffer.from(message));
  console.log(`[x] ${exchange} <- key="${routingKey}" "${message}"`);

  await channel.close();
  await connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
