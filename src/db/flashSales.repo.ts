import { pool } from "../config/db";

export type FlashSaleStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";

export type FlashSale = {
  id: string;
  productId: string;
  productName: string;
  originalPriceCents: number;
  salePriceCents: number;
  totalStock: number;
  remainingStock: number;
  maxPerUser: number;
  startsAt: Date;
  endsAt: Date;
  status: FlashSaleStatus;
};

export async function getFlashSaleById(id: string): Promise<FlashSale | null> {
  const { rows } = await pool.query<FlashSale>(
    `SELECT
       fs.id,
       fs.product_id        AS "productId",
       p.name               AS "productName",
       p.price_cents        AS "originalPriceCents",
       fs.sale_price_cents  AS "salePriceCents",
       fs.total_stock       AS "totalStock",
       fs.remaining_stock   AS "remainingStock",
       fs.max_per_user      AS "maxPerUser",
       fs.starts_at         AS "startsAt",
       fs.ends_at           AS "endsAt",
       fs.status
     FROM flash_sales fs
     JOIN products p ON p.id = fs.product_id
     WHERE fs.id = $1`,
    [id],
  );

  return rows[0] ?? null;
}
