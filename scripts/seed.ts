import { closedb } from "../src/config/db";
import { withTransaction } from "../src/db/transaction";

const STOCK = Number(process.env.SEED_STOCK ?? 100);

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }

  const { productId, saleId } = await withTransaction(async (client) => {
    // Start from a clean slate (dev only!)
    await client.query(
      "TRUNCATE processed_messages, orders, flash_sales, products RESTART IDENTITY CASCADE",
    );

    const product = await client.query<{ id: string }>(
      `INSERT INTO products (name, description, price_cents)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["Wireless Earbuds", "Noise-cancelling, 30h battery", 499900], // ₹4,999.00
    );
    const productId = product.rows[0].id;

    const sale = await client.query<{ id: string }>(
      `INSERT INTO flash_sales
         (product_id, sale_price_cents, total_stock, remaining_stock, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $3, now(), now() + interval '1 hour', 'ACTIVE')
       RETURNING id`,
      [productId, 99900, STOCK], // ₹999.00
    );

    return { productId, saleId: sale.rows[0].id };
  });

  console.log(`[seed] product id=${productId}`);
  console.log(
    `[seed] flash sale id=${saleId}, stock=${STOCK}, active for 1 hour`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closedb());
