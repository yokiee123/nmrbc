#!/usr/bin/env python3
"""Add screenshot-friendly MBD Send View to NMRBC Scheduler app.js / views.css.

Run from scheduler/public:
    python3 add_mbd_send_view.py

Creates .before-send-view.bak backups; does not access Supabase.
"""
from pathlib import Path
import shutil
import sys

root = Path.cwd()
app_path = root / 'app.js'
css_path = root / 'views.css'
if not app_path.is_file() or not css_path.is_file():
    sys.exit('ERROR: Run from scheduler/public (app.js and views.css must be here).')

app = app_path.read_text(encoding='utf-8-sig')
css = css_path.read_text(encoding='utf-8-sig')
if 'function sendView(id, personId' in app or 'MBD SEND VIEW STYLES' in css:
    sys.exit('Send View appears to be already installed. No changes made.')

# Narrow edits to the existing dialog and event detail UI.
old_class = 'classList.remove("day-view-dialog", "print-view-dialog");'
new_class = 'classList.remove("day-view-dialog", "print-view-dialog", "send-view-dialog");'
old_button = '<div class="form-actions"><button class="button outline" id="calendarDownload">Add to calendar</button>'
new_button = '<div class="form-actions"><button class="button primary" id="sendViewButton" type="button">Send View</button><button class="button outline" id="calendarDownload">Add to calendar</button>'
old_wiring = '  $("calendarDownload").onclick = () =>\n    download('
new_wiring = '  $("sendViewButton").onclick = () => sendView(id, personId, date);\n  $("calendarDownload").onclick = () =>\n    download('
insert_marker = 'function eventForm(id = null, prefillDate = null) {'
for label, pattern in [('dialog class reset', old_class), ('details button', old_button),
                       ('details event wiring', old_wiring), ('function insertion point', insert_marker)]:
    hits = app.count(pattern)
    if hits != 1:
        sys.exit(f'ERROR: Expected exactly one {label}, found {hits}; no files changed.')

feature_js = '''// Compact, read-only summary intended for a single mobile screenshot.
function sendView(id, personId = null, date = null) {
  const e = eventBy(id);
  if (!e) return;
  const crew = orderedPeople(crewFor(id));
  const timeLabel = (value) => {
    const match = /^(\\d{1,2}):(\\d{2})/.exec(value || "");
    if (!match) return "To be confirmed";
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
  };
  const detail = (label, value, extra = "") =>
    `<div class="send-info ${extra}"><span>${label}</span><strong>${h(value)}</strong></div>`;
  const companions = crew.map((p) =>
    `<li><span>${h(p.name)}</span><small>${h(roleOf(p))}</small></li>`
  );
  if (e.driver_mode === "other")
    companions.push(`<li><span>${h(e.other_driver_name || "For arrangement")}</span><small>External driver</small></li>`);
  const fullDate = formatDate(e.event_date, {
    weekday: "long", day: "numeric", month: "short", year: "numeric",
  });
  const callTime = timeLabel(e.call_time);
  const endTime = e.end_time ? timeLabel(e.end_time) : "";
  openDialog(
    "Send View",
    `<div class="send-view-shell ${companions.length > 9 ? "send-view-dense" : ""}" id="sendViewShell">
      <div class="send-view-actions">
        <button type="button" class="button outline" id="sendViewBack">← Details</button>
        <button type="button" class="button primary" id="sendViewCapture">Screenshot mode</button>
        <button type="button" class="button outline" data-close>Close</button>
      </div>
      <article class="send-view-card" id="sendViewCard" aria-label="Activity summary for screenshot" tabindex="0">
        <header class="send-card-header">
          <div class="send-card-brand"><span>NMRBC</span><span>ACTIVITY BRIEF</span></div>
          <div class="send-card-title-row"><h2>${h(e.title)}</h2><span class="send-card-status ${h(e.status)}">${h(e.status)}</span></div>
          <p class="send-card-location">${h(e.location || "Venue to be confirmed")}</p>
        </header>
        <section class="send-card-when" aria-label="Event date and time">
          <div><span>DATE</span><strong>${h(fullDate)}</strong></div>
          <div><span>CALL TIME · PHT</span><strong>${h(callTime)}</strong>${endTime ? `<small>Until ${h(endTime)}</small>` : ""}</div>
        </section>
        ${e.status === "cancelled" ? '<p class="send-card-warning">CANCELLED · Please confirm reassignment.</p>' : ""}
        ${needsDriver(e, s.data) ? '<p class="send-card-warning">Driver confirmation pending.</p>' : ""}
        <section class="send-card-facts" aria-label="Activity arrangements">
          ${detail("EXPECTED DONORS", String(e.expected_donors ?? "Not entered"))}
          ${detail("RPO NUMBER", e.rpo_number || "Not entered")}
          ${detail("VEHICLE", e.vehicle_name || "For arrangement")}
          ${detail("DRIVER", driverLabel(e, s.data.personnel))}
          ${e.vehicle_details ? detail("VEHICLE DETAILS", e.vehicle_details, "send-info-wide") : ""}
          ${detail("TRANSPORT / MEETING POINT", e.transport || "To be confirmed", "send-info-wide")}
          ${e.contact_person ? detail("CONTACT PERSON", e.contact_person, "send-info-wide") : ""}
        </section>
        <section class="send-card-team">
          <h3>TEAM / COMPANIONS <span>${companions.length} assigned</span></h3>
          ${companions.length ? `<ul>${companions.join("")}</ul>` : '<p class="send-card-empty">No personnel assigned yet.</p>'}
        </section>
        ${e.notes ? `<section class="send-card-notes"><h3>ADDITIONAL INSTRUCTIONS</h3><p>${h(e.notes)}</p></section>` : ""}
        <footer class="send-card-footer">Northern Mindanao Regional Blood Center · Philippine Time (UTC+8)</footer>
      </article>
      <p class="send-view-tip">Choose <strong>Screenshot mode</strong> to hide these buttons, then take your phone screenshot. Tap the activity card to show controls again.</p>
    </div>`,
    "send-view-dialog",
  );
  const shell = $("sendViewShell");
  const card = $("sendViewCard");
  const setScreenshotMode = (on) => {
    shell.classList.toggle("screenshot-mode", on);
    card.style.zoom = "1";
    if (on) {
      // Scale down modestly if the full summary nearly fits the phone screen.
      // Keep long notes accessible by scrolling rather than making text tiny.
      requestAnimationFrame(() => {
        const available = Math.max(250, window.innerHeight - 28);
        const natural = card.getBoundingClientRect().height;
        const scale = Math.min(1, available / Math.max(natural, 1));
        card.style.zoom = String(Math.max(0.78, scale).toFixed(3));
        $("mainDialog").scrollTop = 0;
      });
    }
  };
  $("sendViewBack").onclick = () => eventDetails(id, personId, date);
  $("sendViewCapture").onclick = () => setScreenshotMode(true);
  card.addEventListener("click", () => {
    if (shell.classList.contains("screenshot-mode")) setScreenshotMode(false);
  });
  card.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && shell.classList.contains("screenshot-mode"))
      setScreenshotMode(false);
  });
}

'''

feature_css = r'''
/* MBD SEND VIEW STYLES: self-contained, screenshot-friendly mobile card. */
#mainDialog.send-view-dialog {
  width: min(430px, calc(100vw - 12px));
  max-height: calc(100dvh - 12px);
  background: #edf0f5;
  color: #1f2a38;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 18px;
}
#mainDialog.send-view-dialog .dialog-heading { display: none; }
#mainDialog.send-view-dialog #dialogBody { padding: 9px; }
.send-view-shell { width: 100%; }
.send-view-actions { display: flex; gap: 5px; margin-bottom: 7px; }
.send-view-actions .button { flex: 1; padding: 8px 5px; font-size: 11px; white-space: nowrap; }
.send-view-actions .button.primary { background: #982e3a; color: #fff; }
.send-view-actions .button.outline { background: #fff; color: #26354a; border-color: #cdd6e0; }
.send-view-card {
  box-sizing: border-box;
  width: 100%;
  background: #fff;
  color: #202d3a;
  border: 1px solid #d7dfe9;
  border-radius: 13px;
  padding: 13px 14px 10px;
  box-shadow: 0 5px 16px #25354a12;
  overflow-wrap: anywhere;
}
.send-card-header { padding-bottom: 9px; border-bottom: 2px solid #982e3a; }
.send-card-brand { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 9px; font-weight: 800; color: #982e3a; letter-spacing: .1em; }
.send-card-brand span:last-child { font-size: 8px; color: #59697b; letter-spacing: .09em; }
.send-card-title-row { display: flex; align-items: start; justify-content: space-between; gap: 7px; margin: 6px 0 3px; }
.send-card-title-row h2 { margin: 0; font-size: 17px; font-weight: 800; line-height: 1.15; }
.send-card-status { flex-shrink: 0; padding: 3px 6px; border-radius: 5px; font-size: 9px; font-weight: 750; text-transform: uppercase; background: #fff2d8; color: #905b07; }
.send-card-status.confirmed { background: #e0f6eb; color: #176d46; }
.send-card-status.cancelled { background: #fce1e5; color: #a21c34; }
.send-card-location { margin: 4px 0 0; color: #4a586b; font-size: 12px; font-weight: 600; line-height: 1.25; white-space: pre-wrap; }
.send-card-when { display: grid; grid-template-columns: 1.3fr 1fr; gap: 6px; margin: 8px 0; }
.send-card-when > div { background: #f5f7fa; border-radius: 7px; padding: 8px 9px; min-width: 0; }
.send-card-when span, .send-info > span { display: block; margin-bottom: 3px; color: #657488; font-size: 9px; font-weight: 800; letter-spacing: .055em; }
.send-card-when strong { display: block; font-size: 14px; font-weight: 850; line-height: 1.2; color: #811e31; }
.send-card-when small { display: block; margin-top: 3px; color: #445267; font-size: 10px; font-weight: 650; }
.send-card-warning { margin: 5px 0; padding: 5px 7px; border-radius: 5px; background: #fff0ea; color: #963c26; font-weight: 750; font-size: 10px; }
.send-card-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 9px; margin-bottom: 9px; }
.send-info { min-width: 0; padding: 4px 0; border-bottom: 1px solid #ecf0f4; }
.send-info strong { display: block; font-size: 11px; font-weight: 700; line-height: 1.2; white-space: pre-wrap; }
.send-info-wide { grid-column: 1 / -1; }
.send-card-team { border-top: 1px solid #d9e1e8; padding-top: 7px; }
.send-card-team h3, .send-card-notes h3 { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; color: #842638; font-size: 10px; margin: 0 0 6px; font-weight: 850; letter-spacing: .04em; }
.send-card-team h3 span { font-size: 9px; font-weight: 600; letter-spacing: 0; color: #6c7988; white-space: nowrap; }
.send-card-team ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 9px; }
.send-card-team li { display: flex; gap: 5px; min-width: 0; align-items: baseline; border-bottom: 1px dotted #e3e8ed; padding: 2px 0 3px; }
.send-card-team li span { flex: 1; min-width: 0; font-size: 10px; line-height: 1.2; font-weight: 650; }
.send-card-team li small { font-size: 9px; color: #657488; flex-shrink: 0; }
.send-card-empty { font-size: 11px; color: #697686; margin: 3px 0; }
.send-card-notes { margin-top: 8px; padding: 7px 8px; background: #f4f6f9; border-radius: 6px; }
.send-card-notes h3 { margin-bottom: 4px; }
.send-card-notes p { margin: 0; font-size: 10px; line-height: 1.3; white-space: pre-wrap; }
.send-card-footer { margin-top: 8px; border-top: 1px solid #e3e9ef; padding-top: 6px; color: #627082; text-align: center; font-size: 8px; font-weight: 600; }
.send-view-tip { color: #435163; margin: 6px 4px 2px; font-size: 10px; text-align: center; line-height: 1.3; }
.send-view-shell.screenshot-mode .send-view-actions, .send-view-shell.screenshot-mode .send-view-tip { display: none; }
.send-view-shell.screenshot-mode .send-view-card { margin: 0 auto; box-shadow: none; cursor: pointer; }
.send-view-dense .send-card-team ul { gap: 1px 8px; }
.send-view-dense .send-card-team li { padding: 1px 0; }
@media (max-width: 360px) {
  #mainDialog.send-view-dialog #dialogBody { padding: 6px; }
  .send-view-card { padding: 10px; }
  .send-card-title-row h2 { font-size: 15px; }
  .send-card-team li span { font-size: 9px; }
  .send-card-team li small { font-size: 8px; }
  .send-view-actions .button { font-size: 10px; padding: 7px 3px; }
}
'''

new_app = app.replace(old_class, new_class, 1).replace(old_button, new_button, 1)
new_app = new_app.replace(old_wiring, new_wiring, 1)
new_app = new_app.replace(insert_marker, feature_js + insert_marker, 1)
new_css = css.rstrip() + '\n\n' + feature_css.lstrip() + '\n'

# Validate the two changes before touching either file.
if new_app.count('function sendView(id, personId') != 1 or new_app.count('id="sendViewButton"') != 1:
    sys.exit('ERROR: Patch validation failed; no files changed.')
for path in (app_path, css_path):
    backup = path.with_name(path.name + '.before-send-view.bak')
    if backup.exists():
        sys.exit(f'ERROR: Backup already exists: {backup}. Nothing changed.')
for path in (app_path, css_path):
    shutil.copy2(path, path.with_name(path.name + '.before-send-view.bak'))
app_path.write_text(new_app, encoding='utf-8')
css_path.write_text(new_css, encoding='utf-8')
print('SUCCESS: Send View added to Activity details.')
print('Changed: app.js, views.css')
print('Backups: app.js.before-send-view.bak, views.css.before-send-view.bak')
print('Next: git diff --check && git diff --stat')
print('Then commit/push only these two files after reviewing.')
