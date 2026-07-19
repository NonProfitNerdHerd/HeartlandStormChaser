import net from "node:net";

/**
 * Local-only NMEA TCP server (GPSComplete/GPSDirect client connects here).
 */
export function createNmeaServer({ host, port, getSentences, logger }) {
  /** @type {Set<import('node:net').Socket>} */
  const clients = new Set();
  let server = null;
  let tickTimer = null;
  let lastPayload = "";

  function broadcast(payload) {
    lastPayload = payload;
    for (const socket of clients) {
      if (socket.destroyed) {
        clients.delete(socket);
        continue;
      }
      try {
        socket.write(payload);
      } catch {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        clients.delete(socket);
      }
    }
  }

  function tick() {
    const sentences = getSentences();
    broadcast(sentences.combined);
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = net.createServer((socket) => {
        clients.add(socket);
        logger.info(`NMEA client connected (${clients.size} total)`);
        try {
          const sentences = getSentences();
          socket.write(sentences.combined || lastPayload);
        } catch (error) {
          logger.warn(`Failed to send initial NMEA: ${error.message}`);
        }

        socket.on("error", () => {
          clients.delete(socket);
        });
        socket.on("close", () => {
          clients.delete(socket);
          logger.info(`NMEA client disconnected (${clients.size} total)`);
        });
      });

      server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `NMEA port ${host}:${port} is already in use. Another bridge instance may be running.`,
            ),
          );
          return;
        }
        reject(error);
      });

      server.listen(port, host, () => {
        logger.info(`NMEA server listening on ${host}:${port}`);
        tickTimer = setInterval(tick, 1000);
        if (typeof tickTimer.unref === "function") {
          tickTimer.unref();
        }
        resolve();
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      for (const socket of clients) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      clients.clear();
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server = null;
    });
  }

  return {
    start,
    stop,
    getClientCount: () => clients.size,
    isListening: () => Boolean(server?.listening),
    getAddress: () => ({ host, port }),
  };
}
