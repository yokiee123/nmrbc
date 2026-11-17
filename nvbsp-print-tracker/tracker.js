import { createClient } from "../scheduler/public/vendor/supabase.js";

const element = (id) => document.getElementById(id);
const loginForm = element("login-form");
const recordForm = element("record-form");
const seriesForm = element("series-form");
const allocationSelect = element("allocation");
const pageSize = 15;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
});
const quantityFormatter = new Intl.NumberFormat("en-PH");
const config = window.SCHEDULER_CONFIG;
const client = createClient(config.supabaseUrl, config.supabasePublishableKey);

let activeUser = null;
let sessionVersion = 0;
let allocations = [];
let cursors = [null];
let snapshot = null;
let busy = false;
let lastRefresh = 0;

function showStatus(message = "", isError = false) {
  const status = element("status");
  status.textContent = message;
  status.toggleAttribute("data-error", isError);
}

function barcode(serial) {
  return serial == null ? "—" : "NVBSP" + serial;
}

function parseBarcode(input) {
  const match = /^(?:NVBSP)?([1-9]\d{10})$/i.exec(input.trim());
  if (!match) throw new Error("Enter a full NVBSP barcode or its 11-digit serial.");
  return Number(match[1]);
}

function manilaToday() {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join("-");
}

function setPrintDate(reset = false) {
  const input = recordForm.elements.printedOn;
  input.max = manilaToday();
  if (reset || !input.value) input.value = input.max;
}

function syncControls() {
  allocationSelect.disabled = busy || !allocations.length;
  element("refresh").disabled = busy;
  element("series-fields").disabled = busy;
  element("record-fields").disabled = busy || !snapshot;
  element("copy-next").disabled = busy || snapshot?.next == null;
  element("previous").disabled = busy || !snapshot || cursors.length === 1;
  element("more").disabled = busy || !snapshot || snapshot.records.length <= pageSize;
  for (const fields of document.querySelectorAll(".receipt-fields")) fields.disabled = busy;
}

function renderReceipt(cell, record) {
  if (record.received_by || !record.printed_by) {
    cell.textContent = record.received_by ?? "—";
    return;
  }

  const details = element("receipt-form-template").content.firstElementChild.cloneNode(true);
  const form = details.querySelector("form");
  const saveReceipt = lock(async (session) => {
    const recipient = form.elements.receivedBy.value.trim();
    if (!recipient) throw new Error("Enter the recipient’s name.");
    showStatus("Saving recipient…");
    const { data, error } = await client.from("nvbsp_print_records")
      .update({ received_by: recipient })
      .eq("first_serial", record.first_serial)
      .is("received_by", null)
      .select("received_by")
      .maybeSingle();
    if (session !== activeUser) return;
    if (error) throw error;
    if (!data) {
      await loadSnapshot(session, cursors);
      if (session === activeUser) showStatus("The receipt record changed. Check the refreshed print history.", true);
      return;
    }
    record.received_by = data.received_by;
    cell.textContent = data.received_by;
    showStatus("Recipient recorded.");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveReceipt();
  });
  cell.append(details);
}

function renderSnapshot() {
  element("next").textContent = barcode(snapshot?.next);
  element("highest").textContent = barcode(snapshot?.highest);
  element("printed").textContent = snapshot ? quantityFormatter.format(snapshot.printed) : "—";
  element("remaining").textContent = snapshot ? quantityFormatter.format(snapshot.remaining) : "—";
  element("next-note").textContent = !snapshot ? "" : snapshot.next == null
    ? "Allocation fully printed."
    : snapshot.highest > snapshot.next ? "There is an unrecorded gap below the highest printed ID." : "";

  const history = element("history");
  history.replaceChildren();
  if (snapshot && !snapshot.records.length) {
    const cell = history.insertRow().insertCell();
    cell.colSpan = 7;
    cell.textContent = "No printed barcodes recorded for this allocation.";
  }
  for (const record of snapshot?.records.slice(0, pageSize) ?? []) {
    const row = history.insertRow();
    const values = [
      barcode(record.first_serial), barcode(record.last_serial),
      quantityFormatter.format(record.last_serial - record.first_serial + 1),
      record.printed_on ?? "—", record.printed_by ?? "—",
    ];
    for (const value of values) row.insertCell().textContent = value;
    renderReceipt(row.insertCell(), record);
    row.insertCell().textContent = record.remarks || "—";
  }
  syncControls();
}

function lock(task) {
  return async () => {
    if (busy || !activeUser) return;
    const session = activeUser;
    busy = true;
    syncControls();
    try {
      await task(session);
    } catch (error) {
      if (session === activeUser) showStatus(error.message, true);
    } finally {
      if (session === activeUser) {
        busy = false;
        syncControls();
      }
    }
  };
}

function renderInventory() {
  const table = element("inventory");
  table.replaceChildren();
  if (!allocations.length) {
    const cell = table.insertRow().insertCell();
    cell.colSpan = 3;
    cell.textContent = "No barcode series in inventory.";
  }
  for (const { first_serial, last_serial } of allocations) {
    const row = table.insertRow();
    row.insertCell().textContent = barcode(first_serial);
    row.insertCell().textContent = barcode(last_serial);
    row.insertCell().textContent = quantityFormatter.format(last_serial - first_serial + 1);
  }
}

async function loadAllocations(session, preferred = allocationSelect.value) {
  const entries = [];
  let before;
  const batchSize = 100;
  do {
    let query = client.from("nvbsp_print_allocations")
      .select("first_serial,last_serial").order("first_serial", { ascending: false }).limit(batchSize);
    if (before != null) query = query.lt("first_serial", before);
    const { data, error } = await query;
    if (session !== activeUser) return;
    if (error) throw error;
    entries.push(...data);
    before = data.length === batchSize ? data.at(-1).first_serial : null;
  } while (before != null);

  allocations = entries;
  allocationSelect.replaceChildren(...allocations.map((allocation) => {
    const option = document.createElement("option");
    option.value = allocation.first_serial;
    option.textContent = barcode(allocation.first_serial) + " to " + barcode(allocation.last_serial);
    return option;
  }));
  const selected = allocations.find((allocation) => String(allocation.first_serial) === String(preferred));
  allocationSelect.value = String((selected ?? allocations[0])?.first_serial ?? "");
  renderInventory();
}

async function loadSnapshot(session, pages = [null]) {
  snapshot = null;
  renderSnapshot();
  if (!allocationSelect.value) return;
  const { data, error } = await client.rpc("nvbsp_print_snapshot", {
    p_allocation: Number(allocationSelect.value),
    p_before: pages.at(-1),
  });
  if (session !== activeUser) return;
  if (error) throw error;
  if (!data) throw new Error("This allocation is unavailable. Refresh the tracker or check your administrator access.");
  snapshot = data;
  cursors = pages;
  lastRefresh = Date.now();
  renderSnapshot();
}

function showLogin() {
  sessionVersion++;
  activeUser = null;
  allocations = [];
  cursors = [null];
  snapshot = null;
  busy = false;
  allocationSelect.replaceChildren();
  seriesForm.reset();
  element("incoming-series").open = false;
  renderInventory();
  recordForm.reset();
  renderSnapshot();
  element("login-panel").hidden = false;
  element("sign-out").hidden = true;
  element("tracker").hidden = true;
  showStatus();
}

const refresh = lock(async (session) => {
  showStatus("Loading print records…");
  snapshot = null;
  renderSnapshot();
  await loadAllocations(session);
  if (session !== activeUser) return;
  await loadSnapshot(session);
  if (session === activeUser) showStatus();
});

async function enterTracker(session) {
  const version = sessionVersion;
  const { data, error } = await client.rpc("scheduler_is_admin");
  if (version !== sessionVersion) return;
  if (error) {
    showLogin();
    showStatus(error.message, true);
    return;
  }
  if (!data) {
    await client.auth.signOut({ scope: "local" });
    showLogin();
    showStatus("An NMRBC Scheduler administrator account is required.", true);
    return;
  }
  activeUser = session.user;
  element("login-panel").hidden = true;
  element("sign-out").hidden = false;
  element("tracker").hidden = false;
  setPrintDate(true);
  await refresh();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  showStatus("Signing in…");
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    });
    loginForm.elements.password.value = "";
    if (error) throw error;
    await enterTracker(data.session);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

element("sign-out").addEventListener("click", async () => {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) showStatus(error.message, true);
  else showLogin();
});
client.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") showLogin();
});

element("refresh").addEventListener("click", refresh);
window.addEventListener("focus", () => {
  if (Date.now() - lastRefresh > 15000) refresh();
});
allocationSelect.addEventListener("change", lock(async (session) => {
  recordForm.reset();
  setPrintDate(true);
  showStatus("Loading print records…");
  await loadSnapshot(session);
  if (session === activeUser) showStatus();
}));
element("more").addEventListener("click", lock(async (session) => {
  await loadSnapshot(session, [...cursors, snapshot.records[pageSize - 1].first_serial]);
  if (session === activeUser) showStatus();
}));
element("previous").addEventListener("click", lock(async (session) => {
  await loadSnapshot(session, cursors.slice(0, -1));
  if (session === activeUser) showStatus();
}));
element("copy-next").addEventListener("click", async () => {
  if (snapshot?.next == null) return;
  const value = barcode(snapshot.next);
  try {
    await navigator.clipboard.writeText(value);
    showStatus("Copied " + value + ".");
  } catch {
    showStatus("Select the displayed barcode to copy it.", true);
  }
});

for (const name of ["first", "last"]) {
  recordForm.elements[name].addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    recordForm.elements[name === "first" ? "last" : "printedOn"].focus();
  });
}

seriesForm.elements.first.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  seriesForm.elements.last.focus();
});
seriesForm.elements.last.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  seriesForm.querySelector("button").focus();
});

const saveSeries = lock(async (session) => {
  const { first, last } = seriesForm.elements;
  const firstSerial = parseBarcode(first.value);
  const lastSerial = parseBarcode(last.value);
  if (firstSerial > lastSerial) throw new Error("The last barcode must be at or after the first barcode.");

  showStatus("Saving barcode series…");
  const { error } = await client.from("nvbsp_print_allocations").insert({
    first_serial: firstSerial, last_serial: lastSerial,
  });
  if (session !== activeUser) return;
  if (error) {
    if (["23505", "23P01"].includes(error.code)) {
      throw new Error("This range overlaps a series already in inventory.");
    }
    throw error;
  }

  seriesForm.reset();
  element("incoming-series").open = false;
  recordForm.reset();
  setPrintDate(true);
  snapshot = null;
  renderSnapshot();
  const message = "Series saved to inventory. " +
    quantityFormatter.format(lastSerial - firstSerial + 1) + " barcode IDs added.";
  try {
    await loadAllocations(session, firstSerial);
    if (session !== activeUser) return;
    await loadSnapshot(session);
  } catch {
    if (session === activeUser) showStatus(message + " Select Refresh to reload the inventory.", true);
    return;
  }
  if (session === activeUser) showStatus(message);
});
seriesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSeries();
});

const saveRecord = lock(async (session) => {
  if (!snapshot) return;
  const allocation = allocations.find((entry) => entry.first_serial === Number(allocationSelect.value));
  const { first, last, printedOn, printedBy, receivedBy, remarks } = recordForm.elements;
  const firstSerial = parseBarcode(first.value);
  const lastSerial = last.value.trim() ? parseBarcode(last.value) : firstSerial;
  if (firstSerial > lastSerial) throw new Error("The last barcode must be at or after the first barcode.");
  if (firstSerial < allocation.first_serial || lastSerial > allocation.last_serial) {
    throw new Error("Both barcodes must belong to the selected allocation.");
  }
  const printer = printedBy.value.trim();
  if (!printer) throw new Error("Enter the name of the person who printed the barcodes.");

  showStatus("Saving print record…");
  const { error } = await client.from("nvbsp_print_records").insert({
    first_serial: firstSerial, last_serial: lastSerial,
    allocation_first: allocation.first_serial, allocation_last: allocation.last_serial,
    printed_on: printedOn.value, printed_by: printer,
    received_by: receivedBy.value.trim() || null, remarks: remarks.value.trim(),
  });
  if (session !== activeUser) return;
  if (error) {
    if (["23505", "23P01"].includes(error.code)) {
      await loadSnapshot(session);
      if (session === activeUser) showStatus("This entry overlaps a recorded barcode or range. Check the print history.", true);
      return;
    }
    throw error;
  }

  recordForm.reset();
  setPrintDate(true);
  const count = lastSerial - firstSerial + 1;
  const message = "Recorded " + quantityFormatter.format(count) + (count === 1 ? " barcode." : " barcodes.");
  try {
    await loadSnapshot(session);
  } catch {
    if (session === activeUser) showStatus(message + " Refresh to reload the latest totals.", true);
    return;
  }
  if (session === activeUser) showStatus(message);
});
recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveRecord();
  recordForm.elements.first.focus();
});

try {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session) await enterTracker(data.session);
  else showLogin();
} catch (error) {
  showLogin();
  showStatus(error.message, true);
}
