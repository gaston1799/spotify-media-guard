function validateSettings(value, defaults) {
  function visit(input, base, key) {
    if (input === undefined) return structuredClone(base);
    if (Array.isArray(base)) {
      if (!Array.isArray(input) || input.length > 100 || input.some(n => !Number.isInteger(n) || n < 0)) throw new Error(key + " must contain non-negative track numbers.");
      return input;
    }
    if (base && typeof base === "object") {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(key + " must be an object.");
      return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, visit(input[k], v, key ? key + "." + k : k)]));
    }
    if (typeof input !== typeof base) throw new Error(key + " has an invalid type.");
    if (typeof base === "number") {
      const minimum = key === "pollMilliseconds" ? 100 : key.endsWith("TrackNumber") ? 0 : key.includes("Cooldown") || key.includes("Timeout") ? 5 : 1;
      if (!Number.isFinite(input) || input < minimum || input > 86400000) throw new Error(key + " is outside its allowed range.");
      if (key.endsWith("spikeThresholdPercent") && input > 100) throw new Error("CPU threshold must be between 1 and 100.");
    }
    if (typeof base === "string" && !/^#[0-9a-f]{6}$/i.test(input)) throw new Error(key + " must be a six-digit hex color.");
    return input;
  }
  return visit(value, defaults, "");
}
module.exports = { validateSettings };
