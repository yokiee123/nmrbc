import { createClient } from "../scheduler/public/vendor/supabase.js";

const element = (id) => document.getElementById(id);
const loginForm = element("login-form");
const recordForm = element("record-form");
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
  element("record-fields").disabled = busy || !snapshot;
  element("copy-next").disabled = busy || snapshot?.next == null;
  element("previous").disabled = busy || !snapshot || cursors.length === 1;
  element("more").disabled = busy || !snapshot || snapshot.records.length <= pageSize;
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
    cell.colSpan = 5;
    cell.textContent = "No printed barcodes recorded for this allocation.";
  }
  for (const record of snapshot?.records.slice(0, pageSize) ?? []) {
    const row = history.insertRow();
    const values = [
      barcode(record.first_serial), barcode(record.last_serial),
      quantityFormatter.format(record.last_serial - record.first_serial + 1),
      record.printed_on ?? "—", record.remarks || "—",
    ];
    for (const value of values) row.insertCell().textContent = value;
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

async function loadAllocations(session) {
  const { data, error } = await client.from("nvbsp_print_allocations")
    .select("first_serial,last_serial").order("first_serial", { ascending: false });
  if (session !== activeUser) return;
  if (error) throw error;
  const selected = allocationSelect.value;
  allocations = data;
  allocationSelect.replaceChildren(...allocations.map((allocation) => {
    const option = document.createElement("option");
    option.value = allocation.first_serial;
    option.textContent = barcode(allocation.first_serial) + " to " + barcode(allocation.last_serial);
    return option;
  }));
  const previous = allocations.find((allocation) => String(allocation.first_serial) === selected);
  allocationSelect.value = String((previous ?? allocations[0])?.first_serial ?? "");
}

async function loadSnapshot(session, pages = [null]) {
  snapshot = null;
  renderSnapshot();
  if (!allocationSelect.value) throw new Error("No NVBSP barcode allocation is configured.");
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

const saveRecord = lock(async (session) => {
  if (!snapshot) return;
  const allocation = allocations.find((entry) => entry.first_serial === Number(allocationSelect.value));
  const { first, last, printedOn, remarks } = recordForm.elements;
  const firstSerial = parseBarcode(first.value);
  const lastSerial = last.value.trim() ? parseBarcode(last.value) : firstSerial;
  if (firstSerial > lastSerial) throw new Error("The last barcode must be at or after the first barcode.");
  if (firstSerial < allocation.first_serial || lastSerial > allocation.last_serial) {
    throw new Error("Both barcodes must belong to the selected allocation.");
  }

  showStatus("Saving print record…");
  const { error } = await client.from("nvbsp_print_records").insert({
    first_serial: firstSerial, last_serial: lastSerial,
    allocation_first: allocation.first_serial, allocation_last: allocation.last_serial,
    printed_on: printedOn.value, remarks: remarks.value.trim(),
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
