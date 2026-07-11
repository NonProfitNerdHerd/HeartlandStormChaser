/**
 * Heartland display timezone: US Central (CST/CDT).
 * Timestamps from the API are UTC; always render in America/Chicago.
 */
(function (root) {
  var TIME_ZONE = "America/Chicago";
  var FORMAT_OPTIONS = {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };

  function parseUtcDate(value) {
    if (!value) return null;
    var normalized = String(value).includes("T")
      ? String(value)
      : String(value).replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized
      : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function formatCentral(value) {
    if (!value) return "—";
    var date = value instanceof Date ? value : parseUtcDate(value);
    if (!date) return String(value);
    return date.toLocaleString("en-US", FORMAT_OPTIONS);
  }

  root.HeartlandTime = {
    TIME_ZONE: TIME_ZONE,
    parseUtcDate: parseUtcDate,
    formatCentral: formatCentral,
  };
})(typeof window !== "undefined" ? window : globalThis);
