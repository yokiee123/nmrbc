import { createClient } from './vendor/supabase.js';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const config = window.SCHEDULER_CONFIG || {};
let client, base, controls, epoch = 0, busy = false;
const PH_DATE = new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'});
const date = (value) => value ? PH_DATE.format(new Date(value)) : '—';
const number = (value) => Number(value || 0).toLocaleString('en-PH');
const message = (value) => { $('message').textContent = value; };

function secretKey(key){
  if(key.startsWith('sb_secret_')) return true;
  try{return key.split('.').length===3 && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role';}
  catch{return false;}
}
async function rpc(name, args={}) {
  const {data,error} = await client.rpc(name,args);
  if(error) throw Error(error.message);
  return data;
}
function status(id,label,type='neutral') {
  const el=$(id);el.textContent=label;el.className=`status ${type}`;
}
function reset() {
  epoch++;
  base = null; controls = null;
  $('privatePanel').hidden=true;
  $('logout').hidden=true;
  $('notifications').replaceChildren();
  status('overallStatus','Sign in required');
}
function crew(snapshot) {
  return (snapshot?.crew||[]).map(p=>`${p.name||'Unnamed'} (${p.duty||'—'})`).join(', ')||'None';
}
function changedItems(n) {
  const a=n.previous_snapshot?.event||{}, b=n.current_snapshot?.event||{};
  const fields=['title','event_date','location','call_time','end_time','status','driver_mode','driver_personnel_id','other_driver_name','vehicle_name','rpo_number','notes'];
  const out=fields.filter(k=>JSON.stringify(a[k]??null)!==JSON.stringify(b[k]??null))
    .map(k=>`${k.replaceAll('_',' ')}: ${a[k]??'(none)'} → ${b[k]??'(none)'}`);
  const before=crew(n.previous_snapshot),after=crew(n.current_snapshot);
  if(before!==after)out.push(`Personnel: ${before} → ${after}`);
  return out.join('\n')||'Event updated';
}
function deliveryLabel(value){return ({pending:'Pending',sending:'Sending',accepted:'Accepted',uncertain:'Uncertain',skipped:'Skipped'})[value]||value||'Unknown';}
function rowHtml(n){
  const ev=n.current_snapshot?.event||n.previous_snapshot?.event||{};
  const details=changedItems(n);
  const reviewOptions=[['pending_review','Pending review'],['amended','Amended'],['not_required','Not required']]
    .map(([v,label])=>`<option value="${v}" ${n.amendment_status===v?'selected':''}>${label}</option>`).join('');
  const stateType=n.status==='accepted'?'good':n.status==='uncertain'||n.status==='sending'?'bad':n.status==='pending'?'warn':'neutral';
  return `<tr><td><strong>#${esc(n.id)} · ${esc(ev.title||'Event')}</strong>
    <div class="cell-sub">${esc(ev.event_date||'')} · revision ${esc(n.revision)} · ${esc(n.kind)}</div></td>
    <td>${esc(date(n.created_at))}</td>
    <td>${esc(n.actor_label||'—')}<div class="cell-sub">${esc(n.change_reason||'')}</div></td>
    <td><span class="status ${stateType}">${esc(deliveryLabel(n.status))}</span>
      <div class="cell-sub">${esc(n.recipient_email||'—')}</div>
      ${n.send_error?`<div class="cell-sub">${esc(n.send_error)}</div>`:''}</td>
    <td><select data-amend="${esc(n.id)}" aria-label="RPO review status for ${esc(ev.title||'event')}">${reviewOptions}</select></td>
    <td><details><summary>Show changes</summary><pre class="changes">${esc(details)}</pre>
    ${n.provider_id?`<p class="cell-sub">Gmail ID: ${esc(n.provider_id)}</p>`:''}</details></td></tr>`;
}
function filteredRows() {
  if(!controls)return [];
  const query=$('historySearch').value.trim().toLowerCase(),state=$('historyStatus').value;
  return (controls.notifications||[]).filter(n=>{
    if(state && n.status!==state)return false;
    if(!query)return true;
    const ev=n.current_snapshot?.event||n.previous_snapshot?.event||{};
    return [n.id,n.kind,n.status,n.actor_label,n.recipient_email,n.change_reason,ev.title,ev.event_date,ev.location]
      .some(v=>String(v??'').toLowerCase().includes(query));
  });
}
function renderHistory(){
  const filtered=filteredRows();const max=Number($('historyLimit').value)||50;
  $('filteredCount').textContent=`Showing ${Math.min(max,filtered.length)} of ${filtered.length} matching records (latest 200 loaded)`;
  $('notifications').innerHTML=filtered.slice(0,max).map(rowHtml).join('')||'<tr><td colspan="6">No matching notifications.</td></tr>';
}
function renderAudit(){
  $('auditRows').innerHTML=(controls?.audit||[]).map(a=>`<tr><td>${esc(date(a.happened_at))}</td><td>${esc(a.action.replaceAll('_',' '))}</td><td>${esc(a.actor)}</td></tr>`).join('')||'<tr><td colspan="3">No admin actions yet.</td></tr>';
}
function render(){
  const s=base.settings, c=controls.control, job=controls.cron, counts=controls.counts;
  const form=$('settingsForm');
  form.elements.maker_name.value=s.maker_name||'';
  form.elements.maker_email.value=s.maker_email||'';
  form.elements.enabled.checked=Boolean(s.enabled);
  for(const [id,key] of [['mPending','pending'],['mAccepted','accepted'],['mUncertain','uncertain'],['mSkipped','skipped'],['mTotal','total']])$(id).textContent=number(counts[key]);
  status('deliveryStatus',c.paused?'Paused':'Allowed',c.paused?'warn':'good');
  status('cronStatus',!job?'Missing':job.active?'Active':'Paused',!job?'bad':job.active?'good':'warn');
  $('deliveryToggle').textContent=c.paused?'▶ Allow RPO delivery':'⏸ Pause RPO delivery';
  $('deliveryToggle').className=c.paused?'':'outline';
  $('cronToggle').textContent=job?.active?'⏸ Pause RPO cron':'▶ Activate RPO cron';
  $('cronToggle').disabled=!job;
  $('cronInfo').textContent=job?`Job #${job.jobid} · ${job.schedule} · only RPO messages`:'No nmrbc-rpo-email cron found.';
  const sending=Number(counts.sending||0);
  status('deliveryHealth',!s.enabled?'Capture disabled':c.paused?'Delivery paused':!job?.active?'Cron paused':sending?'Sending in progress':'Delivery allowed',
    !s.enabled?'warn':c.paused||!job?.active?'warn':'good');
  status('overallStatus',c.paused?'RPO delivery paused':!job?.active?'RPO cron paused':'RPO control enabled',c.paused||!job?.active?'warn':'good');
  $('logout').hidden=false;
  if(!$('testRecipient').value && c.last_test_email)$('testRecipient').value=c.last_test_email;
  if(c.last_test_request_id) $('testResult').textContent=`Last test: request #${c.last_test_request_id} to ${c.last_test_email||'test inbox'} · ${date(c.last_test_at)}`;
  renderHistory();renderAudit();
  $('privatePanel').hidden=false;$('loginPanel').hidden=true;
}
async function load(){
  const current=++epoch;
  try{
    const {data:{session}}=await client.auth.getSession();
    if(current!==epoch)return;
    if(!session){reset();$('loginPanel').hidden=false;message('Sign in with an approved scheduler administrator account.');return;}
    const [s,c]=await Promise.all([rpc('scheduler_rpo_admin_snapshot'),rpc('scheduler_rpo_control_snapshot')]);
    if(current!==epoch)return;
    base=s;controls=c;render();
  }catch(err){
    if(current!==epoch)return;
    reset();$('loginPanel').hidden=false;
    message(/does not exist|schema cache|could not find/i.test(err.message)?
      'Install 01_install_rpo_control_center.sql in the correct Supabase project first.':err.message);
  }
}
async function act(button,fn,success){
  if(busy)return;
  busy=true;button.disabled=true;
  const previous=epoch;
  try{
    const result=await fn();if(previous!==epoch)return;
    await load();if(controls)message(typeof success==='function'?success(result):success);
  }catch(err){if(previous===epoch)message(err.message);}
  finally{busy=false;button.disabled=false;}
}
$('loginForm').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;
  act(form.querySelector('button'),async()=>{
    const {error}=await client.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});
    form.elements.password.value='';if(error)throw Error(error.message);
  },'Signed in.');
};
$('settingsForm').onsubmit=e=>{e.preventDefault();if(!base)return;const f=e.currentTarget;
  const wasEmail=base.settings.maker_email,wasEnabled=base.settings.enabled;
  const mail=f.elements.maker_email.value.trim(),enabled=f.elements.enabled.checked;
  if((wasEmail!==mail||wasEnabled&&!enabled)&&!confirm('Changing the recipient or disabling capture can skip queued messages. Continue?'))return;
  act(f.querySelector('button'),()=>rpc('scheduler_rpo_save_settings',{
    p_name:f.elements.maker_name.value.trim(),p_email:mail,p_enabled:enabled,p_expected:base.settings.version
  }),'RPO maker settings saved.');
};
$('deliveryToggle').onclick=()=>{
  if(!controls)return;const willPause=!controls.control.paused;
  const note=willPause?'Pause RPO delivery? Pending emails will be retained.':
    'Allow new RPO emails? Ensure the historical backlog is resolved. Edge secret RPO_SEND_ENABLED must also be true.';
  if(!confirm(note))return;
  act($('deliveryToggle'),()=>rpc('scheduler_rpo_set_delivery_paused',{p_paused:willPause}),
    willPause?'RPO delivery paused.':'RPO delivery allowed by database gate. Verify the Edge master switch is true.');
};
$('cronToggle').onclick=()=>{
  if(!controls?.cron)return;const enabling=!controls.cron.active;
  if(!confirm(enabling?'Activate only the RPO cron job (every 5 minutes)?':'Pause only the RPO cron job?'))return;
  act($('cronToggle'),()=>rpc('scheduler_rpo_set_cron_active',{p_active:enabling}),enabling?'RPO cron activated.':'RPO cron paused.');
};
$('testForm').onsubmit=e=>{
  e.preventDefault();const recipient=$('testRecipient').value.trim();
  if(!confirm(`Send one RPO test email to ${recipient}? This does not send queued notifications.`))return;
  act($('testButton'),()=>rpc('scheduler_rpo_send_test',{p_email:recipient}),
    r=>`Test HTTP request #${r.request_id} queued for ${r.recipient}. Click Check latest test result to confirm Gmail acceptance.`);
};
$('checkTest').onclick=async()=>{
  if(!controls?.control?.last_test_request_id)return message('No RPO email test has been queued yet.');
  const button=$('checkTest');button.disabled=true;
  try{
    const id=controls.control.last_test_request_id;
    const result=await rpc('scheduler_rpo_test_result',{p_request_id:id});
    if(result.state==='pending'){$('testResult').textContent=`Request #${id}: waiting for HTTP response. Check again shortly.`;return;}
    let response={};try{response=JSON.parse(result.content||'{}');}catch{}
    if(result.status_code===200 && response.ok===true && response.accepted===true){
      $('testResult').textContent=`✓ Gmail accepted test email #${id}. Please also check the destination inbox.`;
    }else{
      $('testResult').textContent=`Test #${id}: HTTP ${result.status_code??'—'}. ${response.error||result.error||result.content||'Review Edge Function logs.'}`;
    }
  }catch(err){message(err.message);}finally{button.disabled=false;}
};
$('skipForm').onsubmit=e=>{
  e.preventDefault();if(!controls)return;
  const boundary=Number($('skipThrough').value);
  if(!Number.isSafeInteger(boundary)||boundary<1)return message('Please provide a valid notification ID.');
  if($('skipConfirm').value.trim()!=='SKIP')return message('Type SKIP exactly to confirm.');
  if(!controls.control.paused)return message('Pause RPO delivery first.');
  if(!confirm(`LAST CHECK: Skip all still-pending RPO notifications with ID ≤ ${boundary}? This includes future-dated events within that range and cannot be undone automatically.`))return;
  act($('skipButton'),()=>rpc('scheduler_rpo_skip_pending_through',{p_through_id:boundary}),
    r=>`Historical reset completed: ${r.skipped} pending notification(s) marked skipped through ID ${r.through_id}.`);
};
$('notifications').onchange=e=>{
  const select=e.target.closest('[data-amend]');if(!select)return;
  act(select,()=>rpc('scheduler_rpo_acknowledge',{p_id:Number(select.dataset.amend),p_status:select.value}),
    'RPO amendment review updated.');
};
for(const id of ['historySearch','historyStatus','historyLimit'])$(id).addEventListener(id==='historySearch'?'input':'change',renderHistory);
$('csvExport').onclick=()=>{
  const rows=filteredRows().slice(0,Number($('historyLimit').value)||50);
  if(!rows.length)return message('No matching rows to export.');
  const safe=v=>{let s=String(v??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const lines=[['ID','Event','Date','Kind','Revision','Status','Recipient','Modified by','Created','Reason'],
    ...rows.map(n=>{const ev=n.current_snapshot?.event||n.previous_snapshot?.event||{};
      return [n.id,ev.title,ev.event_date,n.kind,n.revision,n.status,n.recipient_email,n.actor_label,n.created_at,n.change_reason];})];
  const csv='\uFEFF'+lines.map(row=>row.map(safe).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='nmrbc-rpo-notifications.csv';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
};
$('refresh').onclick=()=>{if(!client||busy)return;load().then(()=>{if(controls)message('RPO status refreshed.');});};
$('logout').onclick=async()=>{
  reset();const {error}=await client.auth.signOut();$('loginPanel').hidden=false;
  message(error?error.message:'Signed out.');
};
async function init(){
  if(!config.supabaseUrl||!config.supabasePublishableKey||secretKey(config.supabasePublishableKey)){
    message('Configure the Scheduler Supabase publishable key in config.js (never a secret key).');return;
  }
  client=createClient(config.supabaseUrl,config.supabasePublishableKey);
  client.auth.onAuthStateChange(event=>{
    if(event==='TOKEN_REFRESHED')return;
    reset();setTimeout(load,0);
  });
  await load();
}
init();
