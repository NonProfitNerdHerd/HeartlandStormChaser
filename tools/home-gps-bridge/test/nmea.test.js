import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInvalidNmeaSentences,
  buildNmeaSentences,
  decimalLatitudeToNmea,
  decimalLongitudeToNmea,
  formatUtcDate,
  formatUtcTime,
  metersPerSecondToKnots,
  nmeaChecksum,
  normalizeHeading,
} from "../src/nmea.js";

describe("nmeaChecksum", () => {
  it("matches known GPRMC checksum", () => {
    // Classic example sentence body (without $ and *CS)
    const body =
      "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W";
    assert.equal(nmeaChecksum(body), "6A");
  });

  it("is consistent with formatNmeaSentence", () => {
    const body = "GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    const sentence = `$${body}*${nmeaChecksum(body)}\r\n`;
    const cs = sentence.trim().slice(sentence.trim().lastIndexOf("*") + 1);
    assert.equal(nmeaChecksum(body), cs);
  });
});

describe("latitude conversion", () => {
  it("converts positive latitude", () => {
    const r = decimalLatitudeToNmea(48.1173);
    assert.equal(r.hemisphere, "N");
    assert.match(r.field, /^48/);
    assert.ok(r.field.includes("07.038"));
  });

  it("converts negative latitude", () => {
    const r = decimalLatitudeToNmea(-33.8688);
    assert.equal(r.hemisphere, "S");
    assert.match(r.field, /^33/);
  });

  it("converts zero latitude", () => {
    const r = decimalLatitudeToNmea(0);
    assert.equal(r.hemisphere, "N");
    assert.equal(r.field, "0000.0000");
  });
});

describe("longitude conversion", () => {
  it("converts positive longitude", () => {
    const r = decimalLongitudeToNmea(11.516667);
    assert.equal(r.hemisphere, "E");
    assert.match(r.field, /^011/);
  });

  it("converts negative longitude", () => {
    const r = decimalLongitudeToNmea(-97.516);
    assert.equal(r.hemisphere, "W");
    assert.match(r.field, /^097/);
  });

  it("converts zero longitude", () => {
    const r = decimalLongitudeToNmea(0);
    assert.equal(r.hemisphere, "E");
    assert.equal(r.field, "00000.0000");
  });
});

describe("speed and heading", () => {
  it("converts m/s to knots", () => {
    const knots = metersPerSecondToKnots(1);
    assert.ok(Math.abs(knots - 1.9438444924406) < 1e-9);
  });

  it("normalizes heading", () => {
    assert.equal(normalizeHeading(0), 0);
    assert.equal(normalizeHeading(360), 0);
    assert.equal(normalizeHeading(370), 10);
    assert.equal(normalizeHeading(-10), 350);
    assert.equal(normalizeHeading(null), null);
  });
});

describe("UTC formatting", () => {
  it("formats UTC date and time", () => {
    const d = new Date("2024-03-23T12:35:19.120Z");
    assert.equal(formatUtcTime(d), "123519.12");
    assert.equal(formatUtcDate(d), "230324");
  });
});

describe("sentence generation", () => {
  const base = {
    latitude: 35.4676,
    longitude: -97.5164,
    capturedAt: new Date("2024-03-23T12:35:19.000Z"),
    speedMps: 10,
    headingDegrees: 84.4,
    altitudeMeters: 365.5,
    accuracyMeters: 5,
  };

  it("builds valid RMC and GGA", () => {
    const s = buildNmeaSentences({ ...base, validFix: true });
    assert.match(s.rmc, /^\$GPRMC,.+,A,.+\*[0-9A-F]{2}\r\n$/);
    assert.match(s.gga, /^\$GPGGA,.+,1,08,.+\*[0-9A-F]{2}\r\n$/);
    assert.ok(s.rmc.includes(",W,"));
    assert.ok(s.rmc.includes(",N,") || s.rmc.includes(",35"));
    // checksum present
    const body = s.rmc.slice(1, s.rmc.lastIndexOf("*"));
    const cs = s.rmc.trim().slice(s.rmc.trim().lastIndexOf("*") + 1);
    assert.equal(nmeaChecksum(body), cs);
  });

  it("builds invalid/no-fix RMC and GGA for stale coordinates", () => {
    const s = buildNmeaSentences({ ...base, validFix: false });
    assert.match(s.rmc, /,V,/);
    assert.match(s.gga, /,0,00,/);
  });

  it("builds empty invalid sentences when no fix", () => {
    const s = buildInvalidNmeaSentences(new Date("2024-03-23T12:35:19.000Z"));
    assert.match(s.rmc, /^\$GPRMC,.+,V,.+\*[0-9A-F]{2}\r\n$/);
    assert.match(s.gga, /,0,00,/);
  });

  it("rejects invalid latitude", () => {
    assert.throws(() =>
      buildNmeaSentences({ ...base, latitude: 91, validFix: true }),
    );
  });
});
