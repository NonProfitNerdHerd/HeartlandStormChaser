import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { buildNmeaSentences } from "../src/nmea.js";
import { createNmeaServer } from "../src/nmea-server.js";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("mock GPS TCP client", () => {
  it("GPSComplete-style client can receive RMC+GGA from 127.0.0.1", async () => {
    const probe = net.createServer();
    const port = await new Promise((resolve, reject) => {
      probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
      probe.on("error", reject);
    });
    await new Promise((r) => probe.close(r));

    const sentences = buildNmeaSentences({
      latitude: 35.4676,
      longitude: -97.5164,
      capturedAt: new Date("2024-06-01T18:00:00.000Z"),
      speedMps: 12,
      headingDegrees: 180,
      altitudeMeters: 350,
      accuracyMeters: 5,
      validFix: true,
    });

    const nmea = createNmeaServer({
      host: "127.0.0.1",
      port,
      getSentences: () => sentences,
      logger: silentLogger,
    });
    await nmea.start();

    const received = await new Promise((resolve, reject) => {
      const chunks = [];
      const client = net.connect({ host: "127.0.0.1", port }, () => {
        // server sends immediately on connect
      });
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("timed out waiting for NMEA"));
      }, 2000);
      client.on("data", (buf) => {
        chunks.push(buf.toString("utf8"));
        const text = chunks.join("");
        if (text.includes("$GPRMC") && text.includes("$GPGGA")) {
          clearTimeout(timer);
          client.end();
          resolve(text);
        }
      });
      client.on("error", reject);
    });

    assert.match(received, /\$GPRMC,.+,A,/);
    assert.match(received, /\$GPGGA,.+,1,/);
    assert.ok(received.includes("\r\n"));
    await nmea.stop();
  });
});
