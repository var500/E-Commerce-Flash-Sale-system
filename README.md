# Flash Sale & Order Processing System: A Step-by-Step Learning Guide

Each phase has a goal, the concepts to learn, the tasks to do, and a checkpoint that tells you when you're done. The phases build on each other, so do them in order.

## The Big Picture (what you're building)

```text
Client ──► API (Express) ──► Redis (atomic stock check) ──► RabbitMQ exchange "orders"
                                                              │
                     ┌────────────────────┬──────────────────┼──────────────────┐
                     ▼                    ▼                  ▼                  ▼
              order-worker         payment-worker     inventory-worker   notification-worker
              (save to DB)         (charge, may fail) (release/confirm)  (email/log)
                                          │
                                   retry queue ⇄ DLQ
```

The main problem you're solving: 10,000 users try to buy 100 items in the same second. You must never oversell, never lose an order, and never crash the database.

---

## Phase 0: Environment Setup

**Tools:** Node.js 20+, Docker Desktop, Postman (or curl), and later autocannon for load testing.

### Tasks:
1. Create a `docker-compose.yml` with three services:
   - `rabbitmq:3-management`: expose ports 5672 (AMQP) and 15672 (the management UI)
   - `postgres:16`: port 5432
   - `redis:7`: port 6379
2. Run `docker compose up -d`.
3. Open `http://localhost:15672` and log in with `guest`/`guest`.

**Checkpoint:** All three containers are running and you can see the RabbitMQ dashboard.

---

## Phase 1: Project Skeleton

**Suggested structure:**
```text
src/
  config/         # env, db, redis, rabbitmq connections
  api/            # express routes + controllers
  services/       # business logic
  workers/        # one file per consumer
  messaging/      # publisher, topology setup, retry helpers
  db/             # migrations / SQL
scripts/          # seed data, load tests
```

### Tasks:
1. Run `npm init` and install `express`, `amqplib`, `pg`, `ioredis`, `dotenv`. Add `nodemon` as a dev dependency.
2. Create a `.env` file for all connection strings. Never hardcode them.
3. Build a `/health` endpoint that checks all three connections.

**Checkpoint:** `GET /health` returns OK for Postgres, Redis and RabbitMQ.

---

## Phase 2: RabbitMQ Fundamentals (do this before any e-commerce code)

**Concepts to learn:** connection vs channel, queue, exchange, binding, routing key, ack/nack, durable queues, persistent messages, prefetch.

### Tasks (write small throwaway scripts in a `playground/` folder):
1. **Hello world:** a producer sends to a queue and a consumer prints the message.
2. **Work queue:** run 2 consumers and send 10 messages. Watch round-robin distribution.
3. **Manual ack:** kill a consumer before it acks, then watch the message get redelivered.
4. **Prefetch:** set `channel.prefetch(1)` and see how it changes the distribution.
5. **Exchange types:** try direct, fanout and topic. Bind queues with patterns like `order.*` and `order.#`.
6. **Durability:** restart the RabbitMQ container. Check which messages survive with `durable: true` + `persistent: true` and which don't.

**Checkpoint:** You can explain why a message was or wasn't lost in each experiment. Read the official RabbitMQ tutorials 1–5 (Node.js version) alongside these exercises.

---

## Phase 3: Data Model

**Tables to design yourself:**
- `products` (id, name, price)
- `flash_sales` (id, product_id, total_stock, start_time, end_time, status)
- `orders` (id, user_id, flash_sale_id, quantity, status, created_at). Status values: PENDING → PAID → CONFIRMED, or FAILED / EXPIRED
- `processed_messages` (message_id PRIMARY KEY). You'll use this for idempotency later.

### Tasks:
1. Write the SQL migrations.
2. Write a seed script that creates 1 product and 1 flash sale with 100 stock.
3. Add a unique constraint on `(user_id, flash_sale_id)` to enforce one purchase per user.

**Checkpoint:** The seed script runs and you can query the sale.

---

## Phase 4: The Naive Version (build it wrong on purpose)

### Tasks:
1. `GET /flash-sales/:id` returns sale info and remaining stock.
2. `POST /flash-sales/:id/buy` reads stock from Postgres. If stock > 0, decrement it and insert the order, synchronously.
3. Load test it with `npx autocannon -c 200 -a 2000 -m POST <url>`. Give each request a different user id (you'll need a small script for that).

**Checkpoint:** You see overselling (more than 100 orders) or a pile of DB errors. Write down the numbers. That failure is the lesson of this phase.

**Things to think about:** Why did it oversell? This is the read-then-write race condition.

---

## Phase 5: Fix Stock with Redis (atomic reservation)

**Concepts:** atomic operations, Lua scripts in Redis, why the DB shouldn't be the hot path.

### Tasks:
1. When a sale starts, load its stock into Redis with a key like `sale:{id}:stock`.
2. Write a Lua script that does all of this in one atomic step:
   - checks whether the user already bought (a Redis SET like `sale:{id}:buyers`)
   - checks stock > 0
   - decrements stock and adds the user to the set
   - returns a code: success / sold out / already bought
3. Call it from the buy endpoint with `redis.eval` or `defineCommand` in ioredis.
4. Run the same load test again.

**Checkpoint:** You get exactly 100 successes and zero oversells, even under heavy load.

---

## Phase 6: Go Asynchronous with RabbitMQ

**Concepts:** accepting a request now and processing it later (HTTP 202), decoupling.

### Tasks:
1. Create a `messaging/topology.js` that asserts everything on startup:
   - a topic exchange `orders.exchange` (durable)
   - queues: `order.created.q`, `payment.q`, `inventory.q`, `notification.q`
   - bindings, e.g. `order.created` → `order` queue, `order.paid` → `inventory` + `notification`
2. Change the buy endpoint:
   - reserve stock with the Lua script
   - generate an orderId (a UUID)
   - publish an `order.created` message containing `{ orderId, userId, saleId, qty, timestamp }`
   - return `202 Accepted` with the orderId
3. Use a ConfirmChannel (publisher confirms) so you know the broker actually received the message. If publishing fails, roll back the Redis reservation.

**Checkpoint:** The endpoint responds in a few milliseconds and messages pile up in the management UI.

---

## Phase 7: Build the Workers

Run each worker as a separate Node process (`node src/workers/orderWorker.js`).

| Worker | Consumes | Does | Publishes |
|--------|----------|------|-----------|
| **order-worker** | `order.created` | Inserts order as PENDING in Postgres | `order.pending` |
| **payment-worker** | `order.pending` | Fakes a payment with a random 20% failure and a delay | `order.paid` / `order.payment_failed` |
| **inventory-worker** | `order.paid`, `order.payment_failed` | Paid: decrements DB stock. Failed: returns stock to Redis | `order.confirmed` |
| **notification-worker** | `order.confirmed`, `order.*failed` | Logs a fake email | nothing |

**Rules for every worker:**
- `noAck: false`, and ack only after the work succeeds
- set `prefetch(N)`
- update order status in the DB at each step

**Checkpoint:** A single order goes all the way from created to confirmed and you can follow it in the logs.

---

## Phase 8: Reliability (the most important phase)

### 8a. Idempotency
RabbitMQ delivers at least once, so a message can arrive twice.
- Include a `messageId` in every message.
- Before processing, insert it into `processed_messages` inside the same DB transaction as the work. On a duplicate key, just ack and skip.
- **Test:** publish the same message twice by hand from the management UI.

### 8b. Retries with backoff (DLX + TTL pattern)
- For each work queue, create a `*.retry.q` that has a `x-message-ttl` (e.g. 5000ms) and `x-dead-letter-exchange` pointing back to the main exchange.
- When processing fails, publish to the retry queue with an `x-retry-count` header, then ack the original.
- After 3 retries, send the message to a `*.dlq` (the "poison message" queue) instead.
- **Test:** make the payment worker throw on purpose and watch the message bounce between the queues in the UI.

### 8c. Reconnection and graceful shutdown
- Handle the connection's `error` and `close` events and reconnect with backoff.
- On SIGINT/SIGTERM: stop consuming, finish in-flight messages, then close the channel and connection.

**Checkpoint:** Kill workers mid-processing and restart RabbitMQ during a load test. No order is lost and none is processed twice.

---

## Phase 9: Payment Timeout (reservation expiry)

In real flash sales, a user who reserved an item but didn't pay within X minutes loses it.

### Tasks:
1. When an order is created, also publish to `order.timeout.q`. This queue has a TTL (e.g. 60s, short for testing) and no consumers. Its dead-letter exchange routes to `order.expired`.
2. An expiry worker consumes `order.expired`. If the order is still PENDING, it marks it EXPIRED and returns the stock to Redis.
3. *Bonus:* read about the `rabbitmq_delayed_message_exchange` plugin as an alternative.

**Checkpoint:** An unpaid order automatically becomes EXPIRED and the stock count goes back up.

---

## Phase 10: API Hardening

- **Rate limiting:** a per-IP / per-user limiter backed by Redis.
- **Sale window check:** reject requests before `start_time` and after `end_time`.
- **Order status endpoint:** `GET /orders/:id` so the client can poll after getting the 202.
- *Bonus:* push status updates to the client with Server-Sent Events.
- **Validation:** use `zod` or `joi` on request bodies.

---

## Phase 11: Load Testing and Observability

1. Rerun the Phase 4 load test and compare the numbers against the naive version.
2. **Scale workers:** run 3 payment workers and watch the queue drain faster.
3. Use structured logging with `pino` and put the `orderId` in every log line (this is a correlation ID).
4. *Bonus:* add Prometheus metrics (queue depth, processing time, failures).

**Checkpoint:** You can show before/after numbers: oversells, p99 latency and throughput.

---

## Stretch Goals (once everything works)

- **Transactional Outbox pattern.** This fixes "the DB was written but publishing failed."
- **Quorum queues** instead of classic queues, for high availability.
- **Dockerize** the API and workers, and run everything with one `docker compose up`.
- **Saga pattern:** formalize the rollback steps across services.
- **Frontend:** a countdown timer, a buy button and a live stock counter.
