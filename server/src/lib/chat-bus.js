// ─────────────────────────────────────────────────────────────────────────────
// chat-bus.js — Real-time delivery for the live chat. Events travel through
// PostgreSQL NOTIFY, so they reach every Node process the host happens to run;
// each process forwards them to its own Server-Sent Events streams. Messages
// themselves are read from the database: events only say what changed.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';

const CHANNEL = 'chat_events';
const PING_MS = 20_000;
const MAX_STREAMS = 400;   // per process; beyond this clients fall back to polling

export function createChatBus({ pool, databaseUrl, log = () => {} }) {
  const listeners = new Set();
  const streams = new Set();
  let client = null, connecting = null, closed = false, retry = null;

  async function connect() {
    const c = new pg.Client({ connectionString: databaseUrl });
    const lost = () => {
      if (client !== c) return;
      client = null;
      if (!closed && listeners.size) retry = setTimeout(ensure, 3000);
    };
    c.on('error', lost);
    c.on('end', lost);
    c.on('notification', msg => {
      let evt;
      try { evt = JSON.parse(msg.payload); } catch { return; }
      for (const fn of listeners) fn(evt);
    });
    await c.connect();
    await c.query(`listen ${CHANNEL}`);
    if (closed) { await c.end().catch(() => {}); return; }
    client = c;
    // Anything sent while the connection was down: streams catch up by themselves
    for (const fn of listeners) fn({ t: 'resync' });
  }

  function ensure() {
    if (client || closed) return Promise.resolve();
    connecting ||= connect().catch(err => {
      log(`chat listener: ${err.message}`);
      if (!closed) retry = setTimeout(ensure, 3000);
    }).finally(() => { connecting = null; });
    return connecting;
  }

  return {
    publish: evt => pool.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(evt)]),

    subscribe(fn) {
      listeners.add(fn);
      ensure();
      return () => listeners.delete(fn);
    },

    /**
     * Turn a request into an event stream. `start` runs once, for catching up;
     * `onEvent` gets each bus event. Both receive send(event, data, id).
     * Streams end after `lifetime`; the browser reconnects and is checked again.
     */
    stream(req, reply, { start, onEvent, onPing, lifetime }) {
      if (streams.size >= MAX_STREAMS) return reply.code(503).send({ error: 'busy', message: 'Try again shortly' });
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',            // nginx must not hold the events back
        Connection: 'close',                  // otherwise an ended stream delays shutdown by the keep-alive time
        'X-Content-Type-Options': 'nosniff',
      });
      const send = (event, data, id) => {
        if (res.writableEnded) return;
        res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      // One event at a time, so catching up and live events never interleave
      let queue = Promise.resolve();
      const run = fn => { queue = queue.then(fn).catch(err => log(`chat stream: ${err.message}`)); };

      let unsubscribe = () => {};
      const entry = {};
      const ping = setInterval(() => {
        if (res.writableEnded) return;
        res.write(': ping\n\n');
        if (onPing) run(onPing);
      }, PING_MS);
      const expiry = setTimeout(() => entry.end(), lifetime);
      entry.end = () => {
        clearInterval(ping);
        clearTimeout(expiry);
        unsubscribe();
        streams.delete(entry);
        if (!res.writableEnded) res.end();
      };
      streams.add(entry);
      req.raw.on('close', entry.end);

      res.write('retry: 3000\n\n');
      send('ready', { at: Date.now() });
      unsubscribe = this.subscribe(evt => run(() => onEvent(evt, send)));
      run(() => start(send));
    },

    async close() {
      closed = true;
      clearTimeout(retry);
      for (const s of [...streams]) s.end();
      listeners.clear();
      if (client) { const c = client; client = null; await c.end().catch(() => {}); }
    },
  };
}
