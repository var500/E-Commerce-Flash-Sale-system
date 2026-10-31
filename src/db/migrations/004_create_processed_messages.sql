-- Idempotency log: "consumer X already handled message Y"
CREATE TABLE processed_messages (
  consumer      TEXT        NOT NULL,
  message_id    TEXT        NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);