// Admin tool for the passphrase database, for what happens outside the site:
// reaching authors and objections that arrive via Telegram.
//   node passphrases-admin.mjs pending                     answers waiting, per banner, with authors and contact attempts
//   node passphrases-admin.mjs contact <agent> <channel> [banner-id] [note...]   log an attempt to reach an author
//   node passphrases-admin.mjs object banner <banner-id> [via]   delete that banner's answers and block new ones
//   node passphrases-admin.mjs object author <agent> [via]       same for every banner by that agent
//   node passphrases-admin.mjs unblock banner|author <key>
//   node passphrases-admin.mjs blocks
// The database is OPENBANNERS_PASSPHRASES_DB (default /var/lib/openbanners/passphrases.sqlite).
import { openDatabase } from "./passphrases.mjs";

const db = openDatabase(process.env.OPENBANNERS_PASSPHRASES_DB || "/var/lib/openbanners/passphrases.sqlite");
const [command, ...args] = process.argv.slice(2);
const day = 24 * 60 * 60 * 1000;
const out = (line) => process.stdout.write(`${line}\n`);

if (command === "pending") {
  const rows = db.prepare(`SELECT a.banner_id, b.title, COUNT(*) AS n, MIN(a.visible_at) AS first
    FROM answers a LEFT JOIN banners b ON b.banner_id = a.banner_id
    WHERE a.status = 'pending' AND a.visible_at > ? GROUP BY a.banner_id ORDER BY first`).all(Date.now());
  if (!rows.length) {
    out("Nothing pending.");
  }
  for (const row of rows) {
    const authors = db.prepare("SELECT agent FROM banner_authors WHERE banner_id = ?").all(row.banner_id).map((r) => r.agent);
    const days = Math.ceil((row.first - Date.now()) / day);
    out(`${row.title ?? row.banner_id}  (${row.banner_id})`);
    out(`  ${row.n} pending, first visible in ${days} days · https://openbanners.org/banner/${encodeURIComponent(row.banner_id)}`);
    out(`  authors: ${authors.join(", ") || "unknown (no logged-in submitter saw them)"}`);
    for (const agent of authors) {
      for (const c of db.prepare("SELECT channel, note, at FROM contact_attempts WHERE agent = ? ORDER BY at").all(agent)) {
        out(`    contacted ${agent} via ${c.channel} on ${new Date(c.at).toISOString().slice(0, 10)}${c.note ? `: ${c.note}` : ""}`);
      }
    }
  }
} else if (command === "contact" && args.length >= 2) {
  const [agent, channel, bannerId = null, ...note] = args;
  db.prepare("INSERT INTO contact_attempts (agent, banner_id, channel, note, at) VALUES (?, ?, ?, ?, ?)")
    .run(agent.toLowerCase(), bannerId, channel, note.join(" ") || null, Date.now());
  out(`Logged: contacted ${agent} via ${channel}.`);
} else if (command === "object" && (args[0] === "banner" || args[0] === "author") && args[1]) {
  const [scope, rawKey, via = "telegram"] = args;
  const key = scope === "author" ? rawKey.toLowerCase() : rawKey;
  db.exec("BEGIN");
  db.prepare("INSERT OR REPLACE INTO blocks (scope, key, via, at) VALUES (?, ?, ?, ?)").run(scope, key, via, Date.now());
  const banners = scope === "banner"
    ? [key]
    : db.prepare("SELECT banner_id FROM banner_authors WHERE agent = ?").all(key).map((r) => r.banner_id);
  let deleted = 0;
  for (const bannerId of banners) {
    deleted += Number(db.prepare("DELETE FROM answers WHERE banner_id = ?").run(bannerId).changes);
  }
  db.exec("COMMIT");
  out(`Blocked ${scope} ${key}; deleted ${deleted} answers on ${banners.length} banner(s).`);
} else if (command === "unblock" && (args[0] === "banner" || args[0] === "author") && args[1]) {
  const key = args[0] === "author" ? args[1].toLowerCase() : args[1];
  const { changes } = db.prepare("DELETE FROM blocks WHERE scope = ? AND key = ?").run(args[0], key);
  out(changes ? `Unblocked ${args[0]} ${key}.` : "No such block.");
} else if (command === "blocks") {
  for (const row of db.prepare("SELECT scope, key, via, at FROM blocks ORDER BY at").all()) {
    out(`${row.scope} ${row.key} (via ${row.via}, ${new Date(row.at).toISOString().slice(0, 10)})`);
  }
} else {
  out("Usage: pending | contact <agent> <channel> [banner-id] [note] | object banner|author <key> [via] | unblock banner|author <key> | blocks");
  process.exitCode = 1;
}
