"use client";
import {useEffect,useMemo,useState} from "react";

type Tab="home"|"remember"|"search"|"people"|"lists"|"import"|"status";
type Sort="best"|"affinity"|"name";
type Person={person_id:string;name?:string;phone?:string;email?:string;instagram?:string;instagram_followers?:number;summary?:string;company?:string;role?:string;affinity_score?:number};
type Interest={topic:string;strength:number};
type Item={person:Person;score?:number;affinity_score?:number;relationship_score?:number;interests:Interest[];memories_count:number;connections_count:number;last_memory?:{raw_note?:string}|null};
type Stats={people:number;memories:number;interests:number;connections:number;missing_instagram:number;average_affinity_score?:number};
type Profile=Item&{memories:Array<{memory_id:string;raw_note?:string;date?:string}>;connections:Array<{connection_id:string;relationship?:string;other_person?:Person}>};

async function crm(action:string,payload:Record<string,unknown>={}){const r=await fetch('/api/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const d=await r.json();if(!d.ok)throw new Error(d.error||'Request failed');return d.data}
const affinity=(x:Item|Profile)=>Number(x.affinity_score??x.person.affinity_score??x.relationship_score??0);
const strength=(n:number)=>Math.round(Math.max(0,Math.min(5,n))/5*100);
const handle=(v?:string)=>String(v||'').replace(/^@/,'');
const compact=(n?:number)=>!n?'':n>=1000000?`${(n/1000000).toFixed(n>=10000000?0:1)}M`:n>=1000?`${(n/1000).toFixed(n>=100000?0:1)}K`:String(n);
function copy(v?:string){if(v)navigator.clipboard.writeText(v)}

function ContactRow({item,rank,onOpen}:{item:Item;rank:number;onOpen:(id:string)=>void}){
 const p=item.person, top=item.interests.slice(0,3);
 return <article className="contactRow">
  <button className="rowMain" onClick={()=>onOpen(p.person_id)}>
   <span className="rank">{rank}</span><span className="identity"><strong>{p.name||'Unknown'}</strong><small>{[p.role,p.company].filter(Boolean).join(' · ')||p.summary||'No details yet'}</small></span>
   <span className="interestLine">{top.map(i=><em key={i.topic}>{i.topic} {strength(i.strength)}</em>)}</span>
   <span className="affinity"><strong>{affinity(item)}</strong><small>affinity</small></span>
  </button>
  <div className="reach">
   {p.phone&&<><a href={`sms:${p.phone}`}>{p.phone}</a><button onClick={()=>copy(p.phone)}>Copy</button></>}
   {p.instagram&&<><a className="instagram" href={`https://instagram.com/${handle(p.instagram)}`} target="_blank" rel="noreferrer">@{handle(p.instagram)}{Number(p.instagram_followers)>=10000&&<b> · {compact(p.instagram_followers)}</b>}</a><button onClick={()=>copy(p.instagram)}>Copy</button></>}
  </div>
 </article>
}

export default function Home(){
 const[tab,setTab]=useState<Tab>('home'),[query,setQuery]=useState(''),[note,setNote]=useState(''),[bulk,setBulk]=useState(''),[sort,setSort]=useState<Sort>('best'),[people,setPeople]=useState<Item[]>([]),[results,setResults]=useState<Item[]>([]),[stats,setStats]=useState<Stats|null>(null),[profile,setProfile]=useState<Profile|null>(null),[lists,setLists]=useState<any[]>([]),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){const[s,p]=await Promise.all([crm('stats'),crm('list_people',{limit:500})]);setStats(s);setPeople(p||[]);try{setLists(await crm('list_lists')||[])}catch{setLists([])}}
 useEffect(()=>{refresh().catch(e=>setStatus(e.message))},[]);
 useEffect(()=>{if(tab!=='search'||!query.trim()){setResults([]);return}const t=setTimeout(()=>crm('search_network',{query,limit:100}).then((d:any[])=>setResults((d||[]).map(r=>({...r,interests:r.interests||[],memories_count:r.matching_memories?.length||0,connections_count:0,last_memory:r.matching_memories?.[0]||null})))).catch(e=>setStatus(e.message)),250);return()=>clearTimeout(t)},[query,tab]);
 const visible=useMemo(()=>{const source=tab==='search'?results:people;const q=tab==='people'?query.trim().toLowerCase():'';let rows=q?source.filter(x=>[x.person.name,x.person.role,x.person.company,x.person.instagram,x.person.phone,x.person.summary,x.interests.map(i=>i.topic).join(' ')].join(' ').toLowerCase().includes(q)):source.slice();if(sort==='affinity')rows.sort((a,b)=>affinity(b)-affinity(a));if(sort==='name')rows.sort((a,b)=>String(a.person.name||'').localeCompare(String(b.person.name||'')));if(sort==='best'&&tab!=='search')rows.sort((a,b)=>affinity(b)-affinity(a)||b.memories_count-a.memories_count);return rows},[people,results,query,sort,tab]);
 async function remember(){if(!note.trim())return;setBusy(true);try{const d=await crm('capture_note',{text:note,source:'web'});setStatus(`Saved to ${d.person?.name||'person'} ✓`);setNote('');await refresh()}catch(e){setStatus(e instanceof Error?e.message:'Save failed')}finally{setBusy(false)}}
 async function importLines(){const lines=bulk.split('\n').map(x=>x.trim()).filter(Boolean);if(!lines.length)return;setBusy(true);try{await crm('bulk_capture',{lines});setBulk('');await refresh();setStatus(`Imported ${lines.length} entries ✓`)}finally{setBusy(false)}}
 async function openProfile(id:string){setProfile(await crm('get_person',{person_id:id}))}
 async function setAffinity(){if(!profile)return;const raw=prompt('Affinity score 0–100',String(affinity(profile)));if(raw===null)return;const value=Math.max(0,Math.min(100,Number(raw)));if(Number.isNaN(value))return;await crm('set_affinity',{person_id:profile.person.person_id,affinity_score:value});await openProfile(profile.person.person_id);await refresh()}
 const nav=(t:Tab,label:string)=><button className={tab===t?'active':''} onClick={()=>{setTab(t);setQuery('');setStatus('')}}>{label}</button>;
 const list=(items:Item[])=><section className="contactList">{items.map((x,i)=><ContactRow key={x.person.person_id} item={x} rank={i+1} onOpen={openProfile}/>)}</section>;
 return <main className="shell">
  <header className="header"><div><p className="eyebrow">PRIVATE NETWORK OS · V0.4</p><h1>Network</h1></div><nav>{nav('home','Home')}{nav('remember','Remember')}{nav('search','Search')}{nav('people','People')}{nav('lists','Lists')}{nav('import','Import')}{nav('status','Status')}</nav></header>
  {status&&<p className="status">{status}</p>}
  {tab==='home'&&<><section className="heroBanner"><strong>{stats?.people||0}</strong><div><h2>People in your network</h2><p>{stats?.memories||0} memories · {stats?.interests||0} interests · {stats?.connections||0} connections</p></div></section><div className="sectionHead"><h2>Best candidates</h2><button onClick={()=>setTab('people')}>View all</button></div>{list(people.slice(0,12))}</>}
  {tab==='remember'&&<section className="card remember"><h2>What should I remember?</h2><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Sharon is a founder, loves poker, @sharon with 120k Instagram followers…"/><button className="primary" disabled={!note.trim()||busy} onClick={remember}>{busy?'Saving…':'Remember'}</button></section>}
  {tab==='search'&&<><section className="searchBar"><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="founders who like poker"/><select value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="best">Best match</option><option value="affinity">Affinity</option><option value="name">Name</option></select></section><p className="resultMeta">{query?`${visible.length} candidates ranked best to worst`:'Search names, roles, stories and interests.'}</p>{list(visible)}</>}
  {tab==='people'&&<><section className="searchBar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter contacts"/><select value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="best">Best candidates</option><option value="affinity">Affinity</option><option value="name">Name</option></select></section><p className="resultMeta">{visible.length} people</p>{list(visible)}</>}
  {tab==='lists'&&<><div className="sectionHead"><h2>Invite lists</h2></div>{lists.length?lists.map(l=><article className="card mini" key={l.list_id}><strong>{l.name}</strong><span>{l.topic||'General'} · {l.member_count} people</span></article>):<section className="card"><p>Deploy the latest Apps Script version to enable lists.</p></section>}</>}
  {tab==='import'&&<section className="card remember"><h2>Bulk import</h2><textarea value={bulk} onChange={e=>setBulk(e.target.value)} placeholder="One person per line"/><button className="primary" disabled={!bulk.trim()||busy} onClick={importLines}>Import</button></section>}
  {tab==='status'&&<section className="card"><h2>Deployment</h2><p>Frontend deploys automatically from main. Apps Script still requires copying Code.gs and deploying a new version.</p></section>}
  {profile&&<div className="modalBackdrop" onClick={()=>setProfile(null)}><section className="profileModal" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setProfile(null)}>×</button><div className="profileTop"><div><h2>{profile.person.name}</h2><p>{[profile.person.role,profile.person.company].filter(Boolean).join(' · ')}</p></div><button className="affinityEdit" onClick={setAffinity}><strong>{affinity(profile)}</strong><span>Affinity · edit</span></button></div><div className="profileReach">{profile.person.phone&&<><a href={`sms:${profile.person.phone}`}>{profile.person.phone}</a><button onClick={()=>copy(profile.person.phone)}>Copy</button></>}{profile.person.instagram&&<><a className="instagram" href={`https://instagram.com/${handle(profile.person.instagram)}`} target="_blank" rel="noreferrer">@{handle(profile.person.instagram)}{Number(profile.person.instagram_followers)>=10000&&` · ${compact(profile.person.instagram_followers)} followers`}</a><button onClick={()=>copy(profile.person.instagram)}>Copy</button></>}</div><div className="chips">{profile.interests.map(i=><span key={i.topic}>{i.topic} {strength(i.strength)}</span>)}</div><h3>Story</h3>{profile.memories.map(m=><article className="memory" key={m.memory_id}><small>{m.date?new Date(m.date).toLocaleDateString():''}</small><p>{m.raw_note}</p></article>)}</section></div>}
 </main>
}
