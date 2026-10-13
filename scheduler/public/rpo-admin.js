import { createClient } from './vendor/supabase.js';
const $ = id => document.getElementById(id);
const h = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg = window.SCHEDULER_CONFIG || {};
let client, snapshot, epoch = 0, busy = false;
const notify = message => { $('message').textContent = message; };
const date = value => value ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
function reset() {
  epoch++; snapshot=null; $('privatePanel').hidden=true;
  $('notifications').replaceChildren();
}
async function rpc(name, args={}) {
  const {data,error} = await client.rpc(name,args);
  if(error) throw Error(error.message);
  return data;
}
function changedItems(n) {
  const a=n.previous_snapshot?.event || {}, b=n.current_snapshot?.event || {};
  const fields=['title','event_date','location','call_time','end_time','status','driver_mode','driver_personnel_id','other_driver_name','vehicle_name','rpo_number','notes'];
  const out=fields.filter(k=>JSON.stringify(a[k]??null)!==JSON.stringify(b[k]??null))
    .map(k=>`${k.replaceAll('_',' ')}: ${a[k]??'(none)'} → ${b[k]??'(none)'}`);
  const crew = x => (x?.crew||[]).map(p=>`${p.name} (${p.duty})`).join(', ') || 'None';
  if(crew(n.previous_snapshot)!==crew(n.current_snapshot))out.push(`Personnel: ${crew(n.previous_snapshot)} → ${crew(n.current_snapshot)}`);
  return out.join('\n') || 'Event updated';
}
function render() {
  const s=snapshot.settings, f=$('settingsForm');
  f.elements.maker_name.value=s.maker_name;
  f.elements.maker_email.value=s.maker_email;
  f.elements.enabled.checked=s.enabled;
  $('notifications').innerHTML=(snapshot.notifications||[]).map(n=>{
    const ev=n.current_snapshot?.event||n.previous_snapshot?.event||{};
    const details=changedItems(n);
    return `<tr><td><strong>${h(ev.title||'Event')}</strong><div class="muted">${h(ev.event_date||'')} · revision ${h(n.revision)}</div></td>
      <td>${h(n.kind)}<div class="muted">${h(date(n.created_at))}</div></td>
      <td>${h(n.actor_label)}<div class="muted">${h(n.change_reason)}</div></td>
      <td>${h(n.status)}${n.send_error?`<div class="muted">${h(n.send_error)}</div>`:''}</td>
      <td><select data-amend="${h(n.id)}" aria-label="RPO amendment status for ${h(ev.title||'event')}">
       ${[['pending_review','Pending review'],['amended','Amended'],['not_required','No amendment required']]
       .map(([value,label])=>`<option value="${value}" ${n.amendment_status===value?'selected':''}>${label}</option>`).join('')}</select></td>
      <td><details><summary>View changes</summary><pre style="white-space:pre-wrap;max-width:360px">${h(details)}</pre></details></td></tr>`;
  }).join('') || '<tr><td colspan="6">No published-event changes recorded yet.</td></tr>';
  $('privatePanel').hidden=false; $('loginPanel').hidden=true;
}
async function load() {
  const current=++epoch;
  try {
    const {data:{session}}=await client.auth.getSession();
    if(current!==epoch)return;
    if(!session){reset();$('loginPanel').hidden=false;notify('Sign in with an approved scheduler administrator account.');return;}
    const data=await rpc('scheduler_rpo_admin_snapshot');
    if(current!==epoch)return;
    snapshot=data; render();
  } catch(err) {
    if(current!==epoch)return;
    reset();$('loginPanel').hidden=false;
    notify(/does not exist|schema cache/i.test(err.message)?'RPO database migration has not been installed yet.':err.message);
  }
}
async function action(button, fn, success) {
  if(busy)return;
  busy=true;button.disabled=true;
  const token=epoch;
  try{await fn();if(token!==epoch)return;await load();if(snapshot)notify(success);}
  catch(err){if(token===epoch)notify(err.message);}
  finally{busy=false;button.disabled=false;}
}
$('loginForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;
  action(f.querySelector('button'),async()=>{const {error}=await client.auth.signInWithPassword({email:f.elements.email.value.trim(),password:f.elements.password.value});f.elements.password.value='';if(error)throw Error(error.message);},'Signed in.');};
$('settingsForm').onsubmit=e=>{e.preventDefault();if(!snapshot)return;const f=e.currentTarget;
  action(f.querySelector('button'),()=>rpc('scheduler_rpo_save_settings',{
    p_name:f.elements.maker_name.value.trim(),p_email:f.elements.maker_email.value.trim(),
    p_enabled:f.elements.enabled.checked,p_expected:snapshot.settings.version
  }),'RPO notification settings saved.');};
$('notifications').onchange=e=>{const select=e.target.closest('[data-amend]');if(!select||!snapshot)return;
  action(select,()=>rpc('scheduler_rpo_acknowledge',{p_id:Number(select.dataset.amend),p_status:select.value}),'Amendment status updated.');};
$('refresh').onclick=()=>load();
$('logout').onclick=async()=>{reset();const {error}=await client.auth.signOut();$('loginPanel').hidden=false;notify(error?error.message:'Signed out.');};
function isSecret(key){if(key.startsWith('sb_secret_'))return true;try{return key.split('.').length===3&&JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role';}catch{return false;}}
async function init(){if(!cfg.supabaseUrl||!cfg.supabasePublishableKey||isSecret(cfg.supabasePublishableKey)){notify('Configure a Supabase publishable key in config.js, never a service-role key.');return;}
 client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
 client.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')return;reset();setTimeout(load,0);});
 await load();
}init();
