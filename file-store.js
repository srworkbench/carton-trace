/* Local demo store. A production host should inject its own database adapter. */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function fileStore(directory) {
  if (typeof directory !== "string" || !directory.trim())
    throw Error("Provide a directory for carton records.");
  const filename = (key) => path.join(directory,
    crypto.createHash("sha256").update(key).digest("hex") + ".json");
  return {
    async get(key) {
      try { return JSON.parse(await fs.readFile(filename(key), "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, value) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const target = filename(key);
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
      try { await fs.rename(temp, target); }
      catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
    },
  };
}

module.exports = { fileStore };
