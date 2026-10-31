CREATE TABLE orders (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT        NOT NULL,
  flash_sale_id     BIGINT      NOT NULL REFERENCES flash_sales(id),
  quantity          INTEGER     NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER     NOT NULL CHECK (unit_price_cents >= 0),
  total_cents       INTEGER     GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  status            TEXT        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'PAID', 'CONFIRMED', 'FAILED', 'EXPIRED')),
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One purchase per user per sale, enforced by the database itself
  CONSTRAINT orders_one_per_user_per_sale UNIQUE (user_id, flash_sale_id)
);

-- For queries like "how many CONFIRMED orders does sale 1 have?" (your oversell check)
CREATE INDEX orders_flash_sale_status_idx ON orders (flash_sale_id, status);

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();