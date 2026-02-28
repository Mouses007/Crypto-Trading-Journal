const knex = require("knex")({ client: "better-sqlite3", connection: { filename: "./tradenote.db" }, useNullAsDefault: true });

async function main() {
  const cols = await knex.raw("PRAGMA table_info(incoming_positions)");
  console.log("Columns:", cols.map(r => r.name).join(", "));

  const count = await knex("incoming_positions").count("* as c");
  console.log("Total rows:", count[0].c);

  const data = await knex("incoming_positions").select("*").limit(3);
  data.forEach(d => {
    // Parse JSON fields
    if (typeof d.raw_data === "string") {
      try { d.raw_data = JSON.parse(d.raw_data); } catch(e) {}
    }
    console.log(JSON.stringify(d, null, 2));
  });
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
