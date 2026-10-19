# Study Notes: Phase 0 through Experiment 6

## Project goal
Build a flash-sale system where **thousands of users try to buy a small stock at the same moment**. The system must:
- **never oversell**
- **never lose an order**
- **never overload the database**

The plan to get there:
- **Redis** checks and reserves stock atomically (all in one step).
- **RabbitMQ** queues orders so workers can process them separately from the HTTP request.
- **Postgres** is the permanent record of orders.

```
Client → API → Redis (reserve stock) → RabbitMQ → Workers → Postgres
```

---

## Phase 0: Environment

| Service | Docker image | Port | Purpose |
|---|---|---|---|
| RabbitMQ | `rabbitmq:3-management` | 5672 (AMQP), 15672 (web UI) | Message broker |
| Postgres | `postgres:16` | 5432 | Permanent data |
| Redis | `redis:7` | 6379 | Fast stock counter, rate limits |

- Start everything with `docker compose up -d`.
- RabbitMQ UI: `http://localhost:15672`, login guest / guest.
- `docker compose restart X` keeps the container's data. `docker compose down` **deletes the containers and their data**, because there's no volume in the compose file.

---

## Phase 1: Skeleton and health check

### Folder layout
```
src/config     connections (env, db, redis, rabbitmq)
src/api        express routes
src/services   business logic
src/workers    message consumers
src/messaging  publishers, queue setup
src/db         SQL / migrations
```

### TypeScript setup
- `tsx` runs `.ts` files directly. `npm run dev` uses `tsx watch` instead of nodemon.
- `npm run typecheck` runs `tsc --noEmit`, which only checks types and outputs no files.
- `.env` must be in the **project root**, because dotenv looks in the folder you run the command from.

### Key ideas, file by file
| File | Main idea |
|---|---|
| `env.ts` | **Fail fast:** crash at startup if a config variable is missing, not halfway through a request |
| `db.ts` | **Connection pool:** reuse a few open connections instead of opening one per query. Always `release()` a client back to the pool. Add a `pool.on("error")` listener, or an idle client error crashes the app |
| `redis.ts` | `lazyConnect` means you control when it connects. `maxRetriesPerRequest: 1` makes commands fail fast when Redis is down. `quit()` waits for pending commands, `disconnect()` doesn't |
| `rabbitmq.ts` | **One connection** (a TCP socket) per app, with lightweight **channels** inside it. The health check opens and closes a test channel to prove the broker really responds |
| `health.routes.ts` | Run all checks **in parallel**, give each a **timeout**, return **200** if all are up and **503** if any is down |
| `server.ts` | **Connect first, then listen.** **Graceful shutdown:** stop taking requests, let in-flight requests finish, close the connections, force-exit after 10s |

### Phase 1 checkpoint answers
1. **Redis recovers on its own but RabbitMQ doesn't.** ioredis has a built-in retry strategy and keeps the same client object. An amqplib connection can't be reused once it closes, and our code never reconnects. Rebuilding a RabbitMQ connection also means recreating channels, queues and consumers, and unacked messages get redelivered. That's why reconnecting is the app's job (Phase 8).
2. **`Promise.all` vs `Promise.allSettled` in shutdown.** `Promise.all` rejects on the first failure. That causes an unhandled rejection, the process crashes with exit code 1, and the remaining cleanup is cut off. `allSettled` lets every close call finish.
3. **503 instead of 200 + "degraded".** Machines (load balancers, Kubernetes, monitors) read the **status code**, not the body. 200 means "send me traffic." Bonus: split health into **liveness** (is the process alive? failing means restart) and **readiness** (are the dependencies up? failing means stop sending traffic).

---

## Phase 2: RabbitMQ basics

### Vocabulary
| Term | Meaning |
|---|---|
| **Producer** | Sends messages |
| **Consumer** | Receives messages |
| **Queue** | Buffer that stores messages until they're consumed |
| **Exchange** | Receives messages from producers and routes them to queues |
| **Binding** | Rule that connects an exchange to a queue, often with a key or pattern |
| **Routing key** | Label on a message that the exchange uses to route it |
| **Connection / Channel** | One TCP socket per app / many light virtual connections inside it |
| **Ack** | Consumer tells the broker "done, you can delete this message" |
| **Prefetch** | Maximum number of unacked messages the broker will send to one consumer |

### Shared helpers: `playground/lib.ts`
- `openChannel()` connects, creates a channel, and closes cleanly on Ctrl+C.
- `sleep(ms)` and `getArg("name", fallback)` read flags like `--prefetch=1`.
- Run every script **from the project root**: `npx tsx playground/<file>.ts`

---

### Experiment 1: Hello World
- `assertQueue` creates the queue if it's missing, and does nothing if it already exists **with the same settings**.
- `sendToQueue` actually publishes to the **default exchange `""`**, which routes each message to the queue whose name equals the routing key.
- `consume(..., { noAck: true })` means auto-ack.
- If `msg` is `null`, the broker cancelled the consumer.

**Lesson:** queues **buffer** messages. The producer and consumer don't need to be running at the same time. This is called **decoupling**.

---

### Experiment 2: Work queue (round-robin)
- Two workers share one queue, and the broker deals messages out in turn.
- **Which worker starts first isn't guaranteed.** It depends on the broker's internal rotation (in my run, A got the even tasks).

**Lessons:**
- To go faster, **add more workers**. No code changes needed.
- **Never assume** a specific worker gets a specific message. Every worker must handle every message type on its queue.

---

### Experiment 3: Acks
| Mode | What happens on a crash |
|---|---|
| **Auto-ack** (`noAck: true`) | Message is deleted **on delivery**. A crash loses **every message already delivered** to that worker, not just the current one |
| **Manual ack** | Unacked messages go back to the queue and are **redelivered** to another consumer with `fields.redelivered = true` |

- **Rule:** always use manual ack, and call `ack` **only after the work has succeeded**.
- **Forgetting to ack** leaves messages stuck as "Unacked" in the UI. They return to Ready when the consumer disconnects, and in the meantime they use memory.
- `redelivered = true` means the message **may already have been processed**, which is why you'll need **idempotency** in Phase 8.

**Bugs I hit and fixed:**
- No `process.exit(1)` in the crash branch, so the worker never actually crashed and nothing was redelivered.
- No "finished" log line.
- The loop started at `i = 0`, which sent 11 tasks instead of 10.

**How to debug like this:** check the broker state with `rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers`. It showed 2 consumers still connected and 0 unacked, which proved A was still alive.

---

### Experiment 4: Prefetch
- **No prefetch:** the broker pushes messages without limit. With alternating slow and fast tasks, one worker gets all the slow ones while the other sits idle.
- **amqplib doesn't wait for your async handler** before sending the next message, so with no prefetch a worker runs **all its tasks at once**.
- **`prefetch(1)`:** one task at a time per worker, and work goes to whichever worker is free. This is called **fair dispatch**.

**Lessons:**
- In Node, prefetch also acts as your **concurrency limit** per worker.
- Always set it in real workers (roughly 1–50). Without it, one worker could pull thousands of orders into memory.

---

### Experiment 5: Exchange types
| Type | Routing rule | Example |
|---|---|---|
| **fanout** | Every bound queue gets every message; the key is ignored | Broadcasts |
| **direct** | Binding key must **exactly equal** the routing key | `paid` gets only `paid` |
| **topic** | Pattern match on dot-separated words: `*` = exactly one word, `#` = zero or more words | `order.*.india`, `order.#` |

- `assertQueue("", { exclusive: true })` creates a queue with a server-generated name that's deleted when the consumer disconnects. Good for temporary subscribers.
- **If no queue is bound, the exchange drops the message silently.** (Bonus: publish with `mandatory: true` and listen for the `return` event to detect this.)
- Each separate service (notifications, analytics, and so on) gets **its own queue** bound to the same exchange, so every service receives a copy.

**Topic test (predict before you run it):**
| Published key | `order.#` | `order.*.india` | `*.paid.*` |
|---|---|---|---|
| `order.created.india` | ✅ | ✅ | ❌ |
| `order.paid.us` | ✅ | ❌ | ✅ |
| `order.paid.india` | ✅ | ✅ | ✅ |
| `order.created` | ✅ | ❌ (needs 3 words) | ❌ |

**In the project:** a topic exchange `orders.exchange` with keys like `order.created`, `order.paid`, `order.failed`.

---

### Experiment 6: Durability
| Queue durable? | Message persistent? | After a broker restart |
|---|---|---|
| ❌ | ❌ | Queue is gone |
| ✅ | ❌ | Queue survives, **messages are lost** |
| ✅ | ✅ | Queue and messages survive |

- **Rule:** order messages need **both** `durable: true` **and** `persistent: true`.
- Check queues with `rabbitmqctl list_queues name durable messages`.
- If you redeclare an existing queue with different settings, you get a **`PRECONDITION_FAILED`** error. Delete the queue first.

---

## Phase 2 checkpoint answers
1. **Why did auto-ack lose all 10 messages?** Without prefetch, the broker pushed all of them to the worker at once and deleted them on delivery. They existed only in the crashed process's memory.
2. **The DB write succeeded but the worker crashed before acking?** The message is redelivered and processed **again**, which could create a duplicate order or a double charge. The fix is idempotency: record the message ID in the same DB transaction and skip duplicates (Phase 8).
3. **Why is prefetch especially important in Node?** Async handlers aren't awaited, so without prefetch a single worker processes an unlimited number of messages at once. That risks running out of memory, exhausting the DB pool and overloading anything downstream.
4. **Notifications and analytics both need `order.paid`?** Use **two queues**, both bound to the exchange. With one shared queue the services would compete for messages, so each would see only some of them.
5. **What is the default exchange?** It's a built-in direct exchange named `""`. Every queue is automatically bound to it with its own name as the key, so `sendToQueue("tasks", ...)` works without declaring an exchange.

---

## Useful commands
```bash
# Queue status
docker compose exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers

# Empty a queue
docker compose exec rabbitmq rabbitmqctl purge_queue tasks

# Restart the broker (keeps data; `down` deletes it)
docker compose restart rabbitmq
```

---

## Next
- Finish Experiments 5 and 6 if not done yet
- Phase 3: Data Model
