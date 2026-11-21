import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import type { EventEnvelope, EventType } from '@haqdaar/shared';
import { stripSchemaParam } from '../config';

export interface EventBusOptions {
  service: string;
  /** Postgres URL. The `pgboss` schema in this database is shared by all services. */
  busUrl: string;
  /** If set, the outbox relay publishes rows from `<outboxSchema>.outbox`. */
  outboxDatabaseUrl?: string;
  relayIntervalMs?: number;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * Durable event bus on pg-boss (Postgres).
 *
 * Publish path:  business tx + outbox row  ->  OutboxRelay  ->  pg-boss publish
 * Consume path:  pg-boss queue per (service, event) -> handler, retried with backoff, then DLQ
 *
 * Handlers MUST be idempotent (an event can be delivered more than once).
 */
export class EventBus implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('EventBus');
  private readonly boss: PgBoss;
  private started = false;
  private registering: Promise<void> = Promise.resolve();
  private readonly pending: Array<{
    types: EventType[];
    handler: EventHandler;
    consumer?: string;
  }> = [];
  private relay?: OutboxRelay;

  constructor(private readonly opts: EventBusOptions) {
    this.boss = new PgBoss({
      connectionString: stripSchemaParam(opts.busUrl).url,
      schema: 'pgboss',
      max: 3,
    });
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss error'));
    if (opts.outboxDatabaseUrl) {
      this.relay = new OutboxRelay(opts.outboxDatabaseUrl, this, opts.relayIntervalMs ?? 300);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    this.started = true;
    await this.ensureQueue(this.dlq(), {});
    for (const s of this.pending.splice(0)) await this.register(s.types, s.handler, s.consumer);
    this.relay?.start();
    this.logger.log(`Event bus ready for "${this.opts.service}"`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
    if (this.started) await this.boss.stop({ graceful: true, timeout: 5000 });
  }

  /** Publish directly (for services without an outbox, e.g. stateless `ai`). */
  async publish(event: EventEnvelope): Promise<void> {
    await this.boss.publish(event.type, event as object);
  }

  /**
   * Subscribe this service to one or more event types. Safe to call before init and concurrently.
   * `consumer` names the handler: two handlers of the same event need different names, each gets
   * its own queue (same queue = jobs would be split between them, not delivered to both).
   */
  async subscribe(
    types: EventType | EventType[],
    handler: EventHandler,
    consumer?: string,
  ): Promise<void> {
    const list = Array.isArray(types) ? types : [types];
    if (!this.started) {
      this.pending.push({ types: list, handler, consumer });
      return;
    }
    // Serialise registrations: concurrent createQueue/subscribe calls race inside pg-boss.
    const next = this.registering.then(() => this.register(list, handler, consumer));
    this.registering = next.catch(() => undefined);
    await next;
  }

  /** Wake the relay right after a transaction commits (lower latency than waiting for the poll). */
  kick(): void {
    this.relay?.kick();
  }

  private async register(
    types: EventType[],
    handler: EventHandler,
    consumer?: string,
  ): Promise<void> {
    for (const type of types) {
      const queue = consumer
        ? `${this.opts.service}__${type}__${consumer}`
        : `${this.opts.service}__${type}`;
      await this.ensureQueue(queue, {
        retryLimit: 5,
        retryDelay: 2,
        retryBackoff: true,
        deadLetter: this.dlq(),
      });
      await this.boss.subscribe(type, queue);
      // pg-boss defaults (poll 2 s, batch 10) cap a queue at ~5 events/s and add up to 2 s latency.
      await this.boss.work<EventEnvelope>(
        queue,
        { batchSize: 50, pollingIntervalSeconds: 0.5 },
        async (jobs) => {
          for (const job of jobs) await handler(job.data);
        },
      );
    }
  }

  /**
   * Create the queue unless it exists. Services booting together can deadlock inside pg-boss's
   * create_queue (Postgres aborts one side): that is transient, so retry with backoff.
   */
  private async ensureQueue(name: string, options: Omit<PgBoss.Queue, 'name'>): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      if (await this.boss.getQueue(name)) return;
      try {
        await this.boss.createQueue(name, { name, ...options } as PgBoss.Queue);
        return;
      } catch (err) {
        if (await this.boss.getQueue(name)) return; // created concurrently by another service
        const transient = ['40P01', '40001', '23505'].includes(
          (err as { code?: string }).code ?? '',
        );
        if (!transient || attempt >= 6) throw err;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt + Math.random() * 100));
      }
    }
  }

  private dlq(): string {
    return `${this.opts.service}__dlq`;
  }
}

/** Polls `<schema>.outbox` and publishes unpublished rows in order. Safe with many replicas (SKIP LOCKED). */
class OutboxRelay {
  private readonly logger = new Logger('OutboxRelay');
  private readonly pool: Pool;
  private readonly table: string;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    databaseUrl: string,
    private readonly bus: EventBus,
    private readonly intervalMs: number,
  ) {
    const { url, schema } = stripSchemaParam(databaseUrl);
    this.pool = new Pool({ connectionString: url, max: 2 });
    this.table = `"${(schema ?? 'public').replace(/"/g, '')}"."outbox"`;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  kick(): void {
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.pool.end();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const client = await this.pool.connect().catch(() => undefined);
    if (!client) {
      this.running = false;
      return;
    }
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; envelope: EventEnvelope }>(
        `SELECT id, envelope FROM ${this.table}
         WHERE published_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      const done: string[] = [];
      for (const row of rows) {
        try {
          await this.bus.publish(row.envelope);
          done.push(row.id);
        } catch (err) {
          this.logger.warn({ err, id: row.id }, 'Publish failed, will retry');
          await client.query(`UPDATE ${this.table} SET attempts = attempts + 1 WHERE id = $1`, [
            row.id,
          ]);
          break; // keep order: stop at the first failure
        }
      }
      if (done.length) {
        await client.query(
          `UPDATE ${this.table} SET published_at = now() WHERE id = ANY($1::uuid[])`,
          [done],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error({ err }, 'Outbox relay tick failed');
    } finally {
      client.release();
      this.running = false;
    }
  }
}
