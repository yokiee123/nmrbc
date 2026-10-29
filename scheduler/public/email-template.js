const BRAND_URL = 'https://crimsoncore.online/';
const escape = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duties = {'AM/T':'AM Testing','AM/C':'AM Component processing','AM/L':'AM Labelling','AM/D':'AM Distribution','PM/T':'PM Testing','PM/C':'PM Component processing',AM:'AM duty',PM:'PM duty',MBD:'Mobile blood donation',OFF:'Day off',LEAVE:'Leave',OFFICE:'Office duty',TRAINING:'Training',CANCELLED:'Cancelled event — Needs reassignment'};
const clock=value=>value?`${String(value).slice(0,5)} Philippine time`:'';
const personLabel=p=>typeof p==='string'?p:`${p?.name||'Unassigned'}${p?.role?` (${p.role})`:''}${p?.code?` · ${p.code}`:''}`;
export function mailBody(job,config){
 const p=job.payload||{},e=p.event;
 const date=new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',dateStyle:'full'}).format(new Date(`${p.date}T00:00:00Z`));
 const subject=`NMRBC — ${job.kind==='test'?'Test reminder':job.kind==='change'?'Schedule updated':'Your schedule'} — ${p.date}`;
 const blocks=[`Hello ${p.name||'colleague'},`,
   `${job.kind==='test'?'TEST EMAIL — ':''}Your schedule for ${date}:`,
   `Assignment: ${duties[p.code]||p.code||'Unassigned — contact the schedule administrator.'}`];
 if(p.description)blocks.push(`Details: ${p.description}`);
 if(e){
   const event=[`Event: ${e.title||'Activity'}`,`Venue: ${e.location||'To be announced'}`,`Call time: ${clock(e.call_time)}`];
   if(e.end_time)event.push(`End time: ${clock(e.end_time)}`);
   event.push(`Event status: ${e.status||'Planned'}`);
   if(e.rpo_number)event.push(`RPO: ${e.rpo_number}`);
   if(e.vehicle_name)event.push(`Vehicle: ${e.vehicle_name}`);
   if(e.transport)event.push(`Transport: ${e.transport}`);
   if(e.notes)event.push(`Notes: ${e.notes}`);
   blocks.push(event.join('\n'));
 }
 if(Array.isArray(p.companions) && p.companions.length)blocks.push(`Companions / event team:\n${p.companions.map(x=>`• ${personLabel(x)}`).join('\n')}`);
 if(p.driver)blocks.push(`Driver: ${typeof p.driver==='string'?p.driver:personLabel(p.driver)}`);
 if(Array.isArray(p.same_day_duties)){
   const am=p.same_day_duties.filter(x=>/^AM(?:\/|$)/.test(x.code||''));
   const pm=p.same_day_duties.filter(x=>/^PM(?:\/|$)/.test(x.code||''));
   if(am.length)blocks.push(`AM duty personnel:\n${am.map(x=>`• ${personLabel(x)}`).join('\n')}`);
   if(pm.length)blocks.push(`PM duty personnel:\n${pm.map(x=>`• ${personLabel(x)}`).join('\n')}`);
 }
 blocks.push('Schedules may change. Check the scheduler for the latest assignment.');
 let link='';
 if(config.url){const u=new URL(config.url);if(u.protocol!=='https:')throw Error('Scheduler URL must use HTTPS');link=u.href;}
 blocks.push('To stop reminders or correct your email, contact your schedule administrator.');
 const text=[...blocks,...(link?[`View scheduler: ${link}`]:[]),`Powered by CrimsonCore: ${BRAND_URL}`].join('\n\n');
 const html=`<div style="font:16px/1.6 Arial,sans-serif;max-width:680px;margin:auto;color:#203139"><h2 style="color:#a12535">NMRBC Schedule${job.kind==='test'?' — Test':''}</h2>${blocks.map(s=>`<p>${escape(s).replace(/\n/g,'<br>')}</p>`).join('')}${link?`<p><a href="${escape(link)}">View latest schedule</a></p>`:''}<div style="border-top:1px solid #e5e7eb;padding-top:14px;margin-top:24px;font:12px/1.6 Arial,sans-serif;color:#64748b">Powered by <a href="${BRAND_URL}" style="color:#a12535;font-weight:700;text-decoration:underline">CrimsonCore</a></div></div>`;
 return {from:config.from,to:[job.recipient],subject,text,html};
}
