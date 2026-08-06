import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const uid=(p:string)=>`${p}_${randomUUID()}`;
const clean=(v:unknown)=>String(v??"").trim();
const clamp=(n:unknown)=>Math.max(0,Math.min(100,Math.round(Number(n)||0)));
const fail=(stage:string,e:any)=>{const m=e?.message||e?.error_description||e?.details||String(e);throw new Error(`${stage}: ${m}`)};

function facts(text:string){
  const out:Array<{fact_type:string;fact_key:string;fact_value:string;confidence:number;source_quote:string}>=[];
  const add=(fact_type:string,fact_key:string,fact_value:string,confidence=80)=>out.push({fact_type,fact_key,fact_value:fact_value.trim(),confidence,source_quote:text});
  const loc=text.match(/\b(?:lives?|based) in ([A-Z][A-Za-z .'-]{2,40})/i); if(loc)add('location','location',loc[1],88);
  const role=text.match(/\b(?:is|works as) (?:an? )?([A-Za-z -]{2,30})(?: at ([A-Z][A-Za-z0-9 &.'-]{2,40}))?/i); if(role){add('role','role',role[1],72);if(role[2])add('company','company',role[2],78)}
  for(const [topic,rx] of Object.entries({poker:/\bpoker\b/i,werewolf:/\bwerewolf|mafia game\b/i,board_games:/\bboard games?\b/i,creator:/\bcreator|influencer|youtube|tiktok\b/i,founder:/\bfounder|entrepreneur|startup\b/i,film:/\bfilm|filmmaker|cinema\b/i,marketing:/\bmarketing|growth\b/i})) if(rx.test(text)) add('interest','topic',topic,90);
  const intro=text.match(/introduced me to ([A-Z][A-Za-z .'-]{2,40})/i); if(intro)add('connection','introduced_to',intro[1],82);
  return out;
}

async function personBundle(){
  const db=getSupabaseAdmin();
  const [{data:people,error:pe},{data:topics,error:te},{data:memories,error:me}]=await Promise.all([
    db.from('people').select('*').order('computed_affinity',{ascending:false}),
    db.from('topic_scores').select('*'),
    db.from('memories').select('id,person_id,raw_note,created_at').order('created_at',{ascending:false})
  ]); if(pe)fail('people',pe);if(te)fail('topics',te);if(me)fail('memories',me);
  const ts=new Map<string,any[]>(), ms=new Map<string,any[]>();
  for(const t of topics||[])ts.set(t.person_id,[...(ts.get(t.person_id)||[]),t]);
  for(const m of memories||[])ms.set(m.person_id,[...(ms.get(m.person_id)||[]),m]);
  return (people||[]).map(p=>({...p,affinity:p.affinity_override??p.computed_affinity,topics:ts.get(p.id)||[],memories:ms.get(p.id)||[]}));
}

function groupMatch(p:any,r:any){
  if(r.topic && !(p.topics||[]).some((t:any)=>t.topic===r.topic&&t.score>=Number(r.topic_min||0)))return false;
  if(r.affinity_min!=null&&Number(p.affinity||0)<Number(r.affinity_min))return false;
  if(r.followers_min!=null&&Number(p.instagram_followers||0)<Number(r.followers_min))return false;
  if(r.role_contains&&!clean(p.role).toLowerCase().includes(clean(r.role_contains).toLowerCase()))return false;
  if(r.company_contains&&!clean(p.company).toLowerCase().includes(clean(r.company_contains).toLowerCase()))return false;
  if(r.inactive_days){const d=p.last_contact?((Date.now()-new Date(p.last_contact).getTime())/86400000):9999;if(d<Number(r.inactive_days))return false;}
  return true;
}

async function dashboard(){
  const db=getSupabaseAdmin(), people=await personBundle();
  const [{data:events},{data:invites},{data:outreach}]=await Promise.all([
    db.from('events').select('*').order('event_date',{ascending:true}).limit(20),
    db.from('event_invites').select('*'),db.from('outreach').select('*').order('created_at',{ascending:false}).limit(20)
  ]);
  const recommendations=people.map(p=>{const days=p.last_contact?Math.floor((Date.now()-new Date(p.last_contact).getTime())/86400000):999;const recent=p.memories?.[0];let score=(p.affinity||0)*.55+Math.min(days,120)*.3+(recent?10:0);const reasons=[];if(days>45)reasons.push(`No contact in ${days} days`);if((p.affinity||0)>=70)reasons.push('High-value relationship');if(!recent)reasons.push('No relationship memory yet');return {...p,priority:clamp(score),days,reasons};}).sort((a,b)=>b.priority-a.priority).slice(0,12);
  return {recommendations,events:events||[],invites:invites||[],outreach:outreach||[],counts:{people:people.length,events:(events||[]).length,drafts:(outreach||[]).filter((x:any)=>x.status==='draft').length}};
}

async function timeline(person_id:string){
  const db=getSupabaseAdmin();
  const [{data:person,error},{data:memories},{data:activities},{data:outreach},{data:invites},{data:facts}]=await Promise.all([
    db.from('people').select('*').eq('id',person_id).single(),db.from('memories').select('*').eq('person_id',person_id),db.from('activities').select('*').eq('person_id',person_id),db.from('outreach').select('*').eq('person_id',person_id),db.from('event_invites').select('*,events(name,event_date)').eq('person_id',person_id),db.from('extracted_facts').select('*').eq('person_id',person_id)
  ]);if(error)fail('person',error);
  const items=[...(memories||[]).map(x=>({type:'memory',date:x.created_at,title:'Memory',detail:x.raw_note})),...(activities||[]).map(x=>({type:x.activity_type,date:x.occurred_at,title:x.title,detail:x.detail})),...(outreach||[]).map(x=>({type:'outreach',date:x.sent_at||x.created_at,title:`${x.channel} ${x.status}`,detail:x.message})),...(invites||[]).map((x:any)=>({type:'invite',date:x.created_at,title:`${x.events?.name||'Event'} · ${x.status}`,detail:(x.reasons||[]).join(' · ')}))].sort((a,b)=>+new Date(b.date)-+new Date(a.date));
  return {person,items,facts:facts||[]};
}

async function groups(action:string,p:any){const db=getSupabaseAdmin();if(action==='save_group'){const row={id:p.id||uid('group'),name:clean(p.name),description:clean(p.description),rules:p.rules||{}};const {data,error}=await db.from('smart_groups').upsert(row).select().single();if(error)fail('save group',error);return data;}const people=await personBundle();const {data,error}=await db.from('smart_groups').select('*').order('updated_at',{ascending:false});if(error)fail('groups',error);return (data||[]).map(g=>({...g,members:people.filter(p=>groupMatch(p,g.rules)),member_count:people.filter(p=>groupMatch(p,g.rules)).length}));}

async function eventCandidates(p:any){const db=getSupabaseAdmin(),people=await personBundle(),topic=clean(p.topic).toLowerCase(),limit=Number(p.limit)||30;const rows=people.map(x=>{const ts=x.topics.find((t:any)=>t.topic===topic);const fit=clamp((ts?.score||0)*.7+(x.affinity||0)*.2+Math.min(Number(x.instagram_followers||0)/5000,10));const reasons=[ts?.score?`${topic} interest ${ts.score}`:'No direct topic evidence',`Affinity ${x.affinity||0}`,x.role?x.role:''].filter(Boolean);return {...x,fit,reasons}}).sort((a,b)=>b.fit-a.fit).slice(0,limit);return rows;}

async function createEvent(p:any){const db=getSupabaseAdmin(),event={id:uid('event'),name:clean(p.name),topic:clean(p.topic).toLowerCase(),event_date:p.event_date||null,notes:clean(p.notes)};const {data,error}=await db.from('events').insert(event).select().single();if(error)fail('create event',error);for(const c of p.candidates||[]){const {error:e}=await db.from('event_invites').upsert({id:uid('invite'),event_id:event.id,person_id:c.person_id||c.id,status:'candidate',fit_score:clamp(c.fit_score||c.fit),reasons:c.reasons||[]},{onConflict:'event_id,person_id'});if(e)fail('save candidates',e)}return data;}
async function updateInvite(p:any){const db=getSupabaseAdmin();const patch:any={status:p.status,updated_at:new Date().toISOString()};if(p.status==='invited')patch.invited_at=new Date().toISOString();if(['confirmed','declined'].includes(p.status))patch.responded_at=new Date().toISOString();const {data,error}=await db.from('event_invites').update(patch).eq('id',p.id).select().single();if(error)fail('update invite',error);return data;}

async function outreach(p:any){const db=getSupabaseAdmin();if(p.action==='draft'){const {data:person,error}=await db.from('people').select('*').eq('id',p.person_id).single();if(error)fail('person',error);const {data:event}=p.event_id?await db.from('events').select('*').eq('id',p.event_id).single():{data:null};const hook=person.summary?`I remembered ${person.summary.toLowerCase()}. `:'';const message=`Hey ${person.name?.split(' ')[0]||'there'}! ${hook}${event?`I’m putting together ${event.name}${event.event_date?` on ${new Date(event.event_date).toLocaleDateString()}`:''} and thought you’d be a great fit.`:'Wanted to reach out and reconnect.'} Would love to have you!`;const row={id:uid('outreach'),person_id:p.person_id,event_id:p.event_id||null,channel:p.channel||'dm',message,status:'draft'};const r=await db.from('outreach').insert(row).select().single();if(r.error)fail('draft outreach',r.error);return r.data;}const {data,error}=await db.from('outreach').update({status:p.status,sent_at:p.status==='sent'?new Date().toISOString():undefined}).eq('id',p.id).select().single();if(error)fail('update outreach',error);return data;}

async function feedback(p:any){const db=getSupabaseAdmin(),row={id:p.id||uid('feedback'),event_id:p.event_id,person_id:p.person_id,interest_score:clamp(p.interest_score),fit_score:clamp(p.fit_score),energy_score:clamp(p.energy_score),reliability_score:clamp(p.reliability_score),notes:clean(p.notes)};const {data,error}=await db.from('event_feedback').upsert(row).select().single();if(error)fail('event feedback',error);await db.from('activities').insert({id:uid('activity'),person_id:p.person_id,activity_type:'event_feedback',title:'Event feedback recorded',detail:row.notes,metadata:row});return data;}

async function duplicates(){const db=getSupabaseAdmin(),people=await personBundle();const {data:decisions}=await db.from('duplicate_decisions').select('*');const ignored=new Set((decisions||[]).map((x:any)=>[x.person_a_id,x.person_b_id].sort().join('|')));const out=[];for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){const a=people[i],b=people[j],key=[a.id,b.id].sort().join('|');if(ignored.has(key))continue;let s=0,reasons=[];if(clean(a.email)&&clean(a.email).toLowerCase()===clean(b.email).toLowerCase()){s+=60;reasons.push('Same email')}if(clean(a.phone)&&clean(a.phone).replace(/\D/g,'')===clean(b.phone).replace(/\D/g,'')){s+=60;reasons.push('Same phone')}if(clean(a.instagram)&&clean(a.instagram).toLowerCase()===clean(b.instagram).toLowerCase()){s+=60;reasons.push('Same Instagram')}const na=clean(a.name).toLowerCase(),nb=clean(b.name).toLowerCase();if(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na))){s+=35;reasons.push('Similar name')}if(s>=35)out.push({a,b,score:clamp(s),reasons});}return out.sort((a,b)=>b.score-a.score).slice(0,50);}

async function mergePeople(p:any){const db=getSupabaseAdmin(),keep=p.keep_id,remove=p.remove_id;for(const table of ['memories','interest_evidence','topic_scores','activities','outreach','event_invites','event_feedback','extracted_facts','list_members']){const {error}=await db.from(table).update({person_id:keep}).eq('person_id',remove);if(error&&error.code!=='23505')fail(`merge ${table}`,error)}const {error}=await db.from('people').delete().eq('id',remove);if(error)fail('delete duplicate',error);await db.from('duplicate_decisions').insert({id:uid('dup'),person_a_id:keep,person_b_id:remove,decision:'merged'});return {merged:true,keep,remove};}

async function extract(p:any){const db=getSupabaseAdmin();const {data:m,error}=await db.from('memories').select('*').eq('id',p.memory_id).single();if(error)fail('memory',error);const rows=facts(m.raw_note).map(f=>({id:uid('fact'),person_id:m.person_id,memory_id:m.id,...f}));if(rows.length){const {error:e}=await db.from('extracted_facts').upsert(rows,{onConflict:'person_id,memory_id,fact_type,fact_key,fact_value'});if(e)fail('facts',e)}return rows;}

export async function POST(req:NextRequest){try{const b=await req.json(),a=clean(b.action),p=b.payload||{};let data:any;switch(a){case'dashboard':data=await dashboard();break;case'timeline':data=await timeline(p.person_id);break;case'groups':case'save_group':data=await groups(a,p);break;case'event_candidates':data=await eventCandidates(p);break;case'create_event':data=await createEvent(p);break;case'update_invite':data=await updateInvite(p);break;case'outreach':data=await outreach(p);break;case'feedback':data=await feedback(p);break;case'duplicates':data=await duplicates();break;case'merge_people':data=await mergePeople(p);break;case'extract_facts':data=await extract(p);break;default:throw new Error(`Unknown action: ${a}`)}return NextResponse.json({ok:true,data},{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500})}}
