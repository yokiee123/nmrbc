import { createClient } from "../scheduler/public/vendor/supabase.js";

const config = window.SCHEDULER_CONFIG;
const client = createClient(config.supabaseUrl, config.supabasePublishableKey);
const archive = document.getElementById("qa-report");
const status = document.getElementById("qa-status");
const controls = document.getElementById("qa-live-controls");
const series = document.getElementById("qa-allocation");
const refreshButton = document.getElementById("qa-refresh");
const printButton = document.getElementById("qa-print");
const quantity = new Intl.NumberFormat("en-PH");
const reportDate = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric",
});
const batchSize = 100;
let currentReport = archive;
let version = 0;
let loading = false;

function showReport(report) {
  currentReport.replaceWith(report);
  currentReport = report;
}

async function allRows(createQuery, ascending) {
  const rows = [];
  let cursor;
  do {
    let query = createQuery().order("first_serial", { ascending }).limit(batchSize);
    if (cursor != null) query = ascending ? query.gt("first_serial", cursor) : query.lt("first_serial", cursor);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    cursor = data.length === batchSize ? data.at(-1).first_serial : null;
  } while (cursor != null);
  return rows;
}

function renderLiveReport(allocation, records) {
  const report = archive.cloneNode(true);
  report.classList.add("live-report");
  const field = (name) => report.querySelector(`[data-qa="${name}"]`);
  const set = (name, value) => { field(name).textContent = value; };
  const total = allocation.last_serial - allocation.first_serial + 1;
  let printed = 0;
  let next = allocation.first_serial;
  const ledger = field("ledger");
  ledger.replaceChildren();

  for (const record of records) {
    const count = record.last_serial - record.first_serial + 1;
    printed += count;
    if (record.first_serial === next) next = record.last_serial + 1;
    const legacyPrinter = /^QA report · Batch \d+ · (.+)$/.exec(record.remarks ?? "");
    const duplicatePrinter = /^\s*printed by:\s*(.+)$/i.exec(record.remarks ?? "");
    const details = [];
    const printer = record.printed_by || legacyPrinter?.[1];
    if (printer) details.push("Printed by " + printer);
    if (record.received_by) details.push("Received by " + record.received_by);
    if (record.remarks && !legacyPrinter && (!duplicatePrinter || duplicatePrinter[1].trim() !== printer)) {
      details.push(record.remarks);
    }

    const row = ledger.insertRow();
    row.className = "bg-white text-slate-700";
    const values = [
      String(ledger.rows.length), "NVBSP" + record.first_serial, "NVBSP" + record.last_serial,
      quantity.format(count), record.printed_on ?? "—", details.join(" · ") || "—",
    ];
    values.forEach((value, index) => {
      const cell = row.insertCell();
      cell.className = "border-r border-slate-200 px-2 py-2";
      if (index === 1 || index === 2) cell.classList.add("serial-code", "font-semibold");
      if (index === 3) cell.classList.add("text-right");
      cell.textContent = value;
    });
  }
  if (!records.length) {
    const cell = ledger.insertRow().insertCell();
    cell.colSpan = 6;
    cell.className = "px-2 py-3";
    cell.textContent = "No printed barcodes recorded for this series.";
  }

  const remaining = total - printed;
  set("copy-label", "QA Distribution Copy");
  set("date-label", "Report Date");
  set("date", reportDate.format(new Date()));
  set("allocated", quantity.format(total));
  set("allocation-range", allocation.first_serial + " – " + allocation.last_serial);
  set("printed-title", "Total Printed");
  set("printed", quantity.format(printed));
  field("printed-detail").hidden = true;
  field("highest-badge").hidden = true;
  set("highest-title", "Highest Printed");
  set("highest", records.at(-1)?.last_serial ?? "—");
  field("highest").classList.add("serial-code", "text-[13px]");
  field("highest-unit").hidden = true;
  field("highest-detail").hidden = true;
  set("remaining", quantity.format(remaining));
  set("remaining-detail", remaining ? "Next: " + next : "Series complete");
  set("batch-label", "Batch");
  set("row-status-title", "Print Date");
  set("handler-label", "Printed / Received By");
  set("balance-formula", quantity.format(total) + " (Allocated) − " + quantity.format(printed) + " (Printed)");
  set("balance-result", "= " + quantity.format(remaining) + " Pcs Available");
  set("prepared-by", "");
  set("reference", "• Live production ledger");
  showReport(report);
}

function showArchive(message) {
  if (currentReport !== archive) showReport(archive);
  controls.hidden = true;
  status.textContent = message;
}

async function loadReport() {
  const request = ++version;
  loading = true;
  printButton.disabled = series.disabled = refreshButton.disabled = true;
  status.textContent = "Loading current QA report…";
  try {
    const { data, error } = await client.auth.getSession();
    if (request !== version) return;
    if (error) throw error;
    if (!data.session) {
      showArchive("September 28 archive. Sign in through the tracker for current totals.");
      return;
    }

    const { data: allowed, error: accessError } = await client.rpc("scheduler_is_admin");
    if (request !== version) return;
    if (accessError) throw accessError;
    if (!allowed) {
      showArchive("September 28 archive. A scheduler administrator account is required for the live report.");
      return;
    }

    const allocations = await allRows(() => client.from("nvbsp_print_allocations").select("first_serial,last_serial"), false);
    if (request !== version) return;
    const allocation = allocations.find(({ first_serial }) => String(first_serial) === series.value) ?? allocations[0];
    if (!allocation) {
      showArchive("September 28 archive. No current barcode series found.");
      return;
    }
    series.replaceChildren(...allocations.map(({ first_serial, last_serial }) => new Option(
      "NVBSP" + first_serial + " – NVBSP" + last_serial, String(first_serial),
    )));
    series.value = String(allocation.first_serial);
    controls.hidden = false;

    const records = await allRows(() => client.from("nvbsp_print_records")
      .select("first_serial,last_serial,printed_on,printed_by,received_by,remarks")
      .eq("allocation_first", allocation.first_serial), true);
    if (request !== version) return;
    renderLiveReport(allocation, records);
    status.textContent = "Live QA report · updated " + new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit",
    }).format(new Date()) + " Philippine time";
  } catch {
    if (request !== version) return;
    showArchive("Current records could not be loaded. Showing the September 28 archive.");
  } finally {
    if (request === version) {
      loading = false;
      printButton.disabled = series.disabled = refreshButton.disabled = false;
    }
  }
}

series.addEventListener("change", loadReport);
refreshButton.addEventListener("click", loadReport);
window.addEventListener("focus", () => {
  if (!loading) loadReport();
});
client.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    version++;
    loading = false;
    showArchive("September 28 archive. Sign in through the tracker for current totals.");
    printButton.disabled = series.disabled = refreshButton.disabled = false;
  }
});

await loadReport();
