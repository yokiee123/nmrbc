import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("NVBSP print records are private, reject overlap and preserve the first gap", async () => {
  const db = new PGlite();
  try {
    const admin = "11111111-1111-4111-8111-111111111111";
    const staff = "22222222-2222-4222-8222-222222222222";
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      INSERT INTO auth.users VALUES ('${admin}', 'admin@example.test'), ('${staff}', 'staff@example.test');
    `);
    const sqlFile = (name) => readFile(new URL("../supabase/" + name, import.meta.url), "utf8");
    await db.exec(await sqlFile("schema.sql"));
    await db.query("INSERT INTO scheduler_private.admins(user_id, display_name) VALUES ($1, 'Print administrator')", [admin]);
    const migration = await sqlFile("nvbsp-print-tracker.sql");
    await db.exec(migration);
    await db.exec(migration);

    const inventoryMigration = await sqlFile("nvbsp-series-inventory.sql");
    await db.exec(inventoryMigration);
    await db.exec(inventoryMigration);

    const allocation = [20269249951, 20269252950];
    const newPool = [20269252951, 20269252960];
    const addSeries = (first, last) => db.query(
      "INSERT INTO nvbsp_print_allocations (first_serial, last_serial) VALUES ($1, $2)",
      [first, last],
    );
    const role = (name, uid = "") => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${uid}'; SET ROLE ${name};`);
    const snapshot = async (first = allocation[0], before = null) =>
      (await db.query("SELECT nvbsp_print_snapshot($1, $2) AS data", [first, before])).rows[0].data;
    const record = (first, last, date = "2026-09-28", pool = allocation, printer = "Print Operator", recipient = null) => db.query(`
      INSERT INTO nvbsp_print_records
        (first_serial, last_serial, allocation_first, allocation_last, printed_on, printed_by, received_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [first, last, ...pool, date, printer, recipient]);
    const receive = (first, recipient) => db.query(
      "UPDATE nvbsp_print_records SET received_by = $2 WHERE first_serial = $1 AND received_by IS NULL RETURNING received_by",
      [first, recipient],
    );

    await role("anon");
    await assert.rejects(snapshot(), { code: "42501" });
    await assert.rejects(addSeries(...newPool), { code: "42501" });
    await assert.rejects(db.query("SELECT * FROM nvbsp_print_records"), { code: "42501" });
    await role("authenticated", staff);
    assert.equal(await snapshot(), null);
    await assert.rejects(addSeries(...newPool), { code: "42501" });
    await assert.rejects(record(20269251911, 20269251911), { code: "42501" });

    await role("authenticated", admin);
    const baseline = await snapshot();
    assert.equal(baseline.highest, 20269251910);
    assert.equal(baseline.next, 20269251911);
    assert.equal(baseline.printed, 1960);
    assert.equal(baseline.remaining, 1040);
    assert.equal(baseline.records.length, 5);
    assert.equal(baseline.records[0].printed_by, null);
    assert.equal(baseline.records[0].received_by, null);

    await assert.rejects(record(20269251911, 20269251911, "9999-01-01"), { code: "42501" });
    await assert.rejects(record(20269251911, 20269251911, "2026-09-28", allocation, null), { code: "42501" });
    await assert.rejects(record(20269251911, 20269251911, "2026-09-28", allocation, " "), { code: "23514" });
    await record(20269251913, 20269251915);
    await assert.rejects(record(20269251912, 20269251914), { code: "23P01" });
    await assert.rejects(record(20269251913, 20269251913), { code: "23505" });
    await assert.rejects(record(20269252950, 20269252951), { code: "23514" });
    await assert.rejects(db.query("UPDATE nvbsp_print_records SET remarks = 'edited'"), { code: "42501" });
    const gap = await snapshot();
    assert.equal(gap.highest, 20269251915);
    assert.equal(gap.next, 20269251911);
    assert.equal(gap.remaining, 1037);
    assert.equal(gap.records[0].printed_by, "Print Operator");
    assert.equal(gap.records[0].received_by, null);
    await role("authenticated", staff);
    assert.deepEqual((await receive(20269251913, "Unauthorized")).rows, []);
    await role("authenticated", admin);
    await assert.rejects(receive(20269251913, " "), { code: "23514" });
    assert.deepEqual((await receive(20269251913, "Receiving Officer")).rows, [{ received_by: "Receiving Officer" }]);
    assert.deepEqual((await receive(20269251913, "Replacement")).rows, []);
    assert.equal((await snapshot()).records[0].received_by, "Receiving Officer");
    assert.equal((await snapshot()).printed, gap.printed);
    await assert.rejects(db.query("UPDATE nvbsp_print_records SET printed_by = 'Replacement'"), { code: "42501" });

    await record(20269251911, 20269251911, "2026-09-28", allocation, "Print Operator", "Same-day Recipient");
    assert.equal((await snapshot()).next, 20269251912);
    assert.equal((await snapshot()).records[1].received_by, "Same-day Recipient");
    await record(20269251912, 20269251912);
    assert.equal((await snapshot()).next, 20269251916);
    await record(20269251916, 20269252950);
    const complete = await snapshot(allocation[0], 20269251912);
    assert.equal(complete.next, null);
    assert.equal(complete.remaining, 0);
    assert.equal(complete.printed, 3000);
    assert.equal(complete.records[0].first_serial, 20269251911);
    assert.equal((await db.query("SELECT recorded_by FROM nvbsp_print_records WHERE first_serial = 20269251911")).rows[0].recorded_by, admin);

    await assert.rejects(addSeries(newPool[1], newPool[0]), { code: "23514" });
    await assert.rejects(addSeries(allocation[1], newPool[1]), { code: "23P01" });
    await addSeries(...newPool);
    await assert.rejects(addSeries(...newPool), { code: "23505" });
    await assert.rejects(addSeries(20269252958, 20269252965), { code: "23P01" });
    assert.deepEqual(await snapshot(newPool[0]), {
      highest: null, next: newPool[0], printed: 0, remaining: 10, records: [],
    });
    await record(newPool[1], newPool[1], "2026-09-28", newPool);
    assert.equal((await snapshot(newPool[0])).next, newPool[0]);
    assert.equal((await snapshot(newPool[0])).remaining, 9);
    assert.equal((await snapshot()).remaining, 0);
  } finally {
    await db.close();
  }
});
