CREATE TABLE flash_sales (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        BIGINT      NOT NULL REFERENCES products(id),
  sale_price_cents  INTEGER     NOT NULL CHECK (sale_price_cents >= 0),
  total_stock       INTEGER     NOT NULL CHECK (total_stock > 0),
  remaining_stock   INTEGER     NOT NULL CHECK (remaining_stock >= 0),
  max_per_user      INTEGER     NOT NULL DEFAULT 1 CHECK (max_per_user > 0),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT flash_sales_valid_window      CHECK (ends_at > starts_at),
  CONSTRAINT flash_sales_stock_within_total CHECK (remaining_stock <= total_stock)
);

-- Postgres does NOT automatically index foreign key columns
CREATE INDEX flash_sales_product_id_idx ON flash_sales (product_id);

CREATE TRIGGER flash_sales_set_updated_at
BEFORE UPDATE ON flash_sales
FOR EACH ROW EXECUTE FUNCTION set_updated_at();