"use client";

import { useMemo, useState } from "react";

type Tab = "home" | "import" | "followups" | "health";
type Person = { person_id?: string; name?: string; phone?: string; instagram?: string; summary?: string; importance?: number };
type SearchResult = { score?: number; person: Person; reasons?: string[]; matching_memories?: Array<{ raw_note?: string }> };
type Followup = { followup_id: string; task: string; due_date?: string; person?: Person };

async function crm(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch("/api/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data.data;
}

function looksLikeSearch(value: string) {
  const text = value.trim().toLowerCase();
  return text.endsWith("?") || /^(who|show|find|which|people|search|anyone)\b/.test(text);
}

function copy(value?: string) {
  if (value) navigator.clipboard.writeText(value);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [command, setCommand] = useState("");
  const [bulk, setBulk] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const mode = useMemo(() => looksLikeSearch(command) ? "Search" : "Remember", [command]);

  async function submitCommand() {
    if (!command.trim()) return;
    setBusy(true); setStatus("");
    try {
      if (looksLikeSearch(command)) {
        const data = await crm("search_network", { query: command.replace(/\?$/, ""), limit: 40 });
        setResults(data || []);
        setStatus(`${(data || []).length} people found`);
      } else {
        const data = await crm("capture_note", { text: command, source: "web command bar" });
        const name = data?.person?.name || data?.person?.phone || "person";
        setStatus(`Saved to ${name} ✓`);
        setCommand("");
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function importLines() {
    const lines = bulk.split("\n").map(x => x.trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy(true); setStatus("");
    try {
      const data = await crm("bulk_capture", { lines, source: "bulk paste" });
      setStatus(`Processed ${data?.processed || lines.length} contacts ✓`);
      setBulk("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }

  async function loadFollowups() {
    setBusy(true); setStatus("");
    try { setFollowups(await crm("get_followups", { status: "Open", limit: 100 }) || []); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not load follow-ups"); }
    finally { setBusy(false); }
  }

  async function complete(id: string) {
    await crm("complete_followup", { followup_id: id });
    setFollowups(current => current.filter(item => item.followup_id !== id));
  }

  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">PRIVATE NETWORK OS</p><h1>Network</h1></div>
        <nav>
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>Home</button>
          <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>Import</button>
          <button className={tab === "followups" ? "active" : ""} onClick={() => { setTab("followups"); loadFollowups(); }}>Follow-ups</button>
          <button className={tab === "health" ? "active" : ""} onClick={() => setTab("health")}>Health</button>
        </nav>
      </header>

      {tab === "home" && <>
        <section className="hero card">
          <div className="mode">{mode}</div>
          <textarea value={command} onChange={e => setCommand(e.target.value)} placeholder="Remember or ask anything…\n\nChloe really likes Werewolf and wants coworking\nWho should I invite to Werewolf?" />
          <div className="commandFooter"><span>{command.length} characters</span><button className="primary" disabled={!command.trim() || busy} onClick={submitCommand}>{busy ? "Working…" : mode}</button></div>
          {status && <p className="status">{status}</p>}
        </section>

        {results.length > 0 && <section className="results">
          <div className="sectionTitle"><h2>Best matches</h2><span>{results.length}</span></div>
          {results.map((result, index) => {
            const p = result.person || {};
            const evidence = result.reasons?.[0] || result.matching_memories?.[0]?.raw_note || p.summary;
            return <article className="personCard" key={p.person_id || index}>
              <div className="rank">{index + 1}</div>
              <div className="personMain">
                <div className="personHeading"><div><h3>{p.name || "Unknown person"}</h3><p>{p.instagram || "No Instagram"}</p></div><div className="score">{Math.round(result.score || p.importance || 0)}</div></div>
                <div className="copyGrid">
                  <button onClick={() => copy(p.name)}><small>Name</small>{p.name || "—"}</button>
                  <button onClick={() => copy(p.instagram)}><small>Instagram</small>{p.instagram || "—"}</button>
                  <button onClick={() => copy(p.phone)}><small>Phone</small>{p.phone || "—"}</button>
                </div>
                {evidence && <div className="evidence"><strong>Why this matched</strong><p>{evidence}</p></div>}
                <div className="actions">
                  {p.phone && <a href={`sms:${p.phone}`}>Text</a>}
                  {p.phone && <a href={`tel:${p.phone}`}>Call</a>}
                  {p.instagram && <a target="_blank" href={`https://instagram.com/${p.instagram.replace("@", "")}`}>Instagram</a>}
                </div>
              </div>
            </article>;
          })}
        </section>}
      </>}

      {tab === "import" && <section className="card">
        <p className="eyebrow">BULK CAPTURE</p><h2>Paste one person per line</h2>
        <p className="muted">Phone or Instagram updates a unique existing person. Otherwise a new person is created. Raw context is always preserved.</p>
        <textarea className="bulk" value={bulk} onChange={e => setBulk(e.target.value)} placeholder="Chloe, 917-555-0123, really likes Werewolf, @chloepoker\nKieran, founder, creator, close friend of Chloe\n646-555-0198, wants coworking, important" />
        <button className="primary wide" disabled={!bulk.trim() || busy} onClick={importLines}>{busy ? "Importing…" : "Import contacts"}</button>
        {status && <p className="status">{status}</p>}
      </section>}

      {tab === "followups" && <section>
        <div className="sectionTitle"><div><p className="eyebrow">RELATIONSHIP MOMENTUM</p><h2>Open follow-ups</h2></div><button onClick={loadFollowups}>Refresh</button></div>
        {!followups.length && <div className="empty card">Nothing due right now.</div>}
        {followups.map(item => <article className="task card" key={item.followup_id}><div><h3>{item.person?.name || item.person?.phone || "Unknown person"}</h3><p>{item.task}</p><small>{item.due_date || "No due date"}</small></div><button onClick={() => complete(item.followup_id)}>Done</button></article>)}
      </section>}

      {tab === "health" && <section className="card health">
        <p className="eyebrow">GAMIFICATION</p><h2>Network Health</h2><div className="healthScore">—</div>
        <p>Your score will reward useful behavior rather than busywork:</p>
        <ul><li>Logging context about someone</li><li>Adding missing phone or Instagram information</li><li>Inviting a strong-fit person</li><li>Following up with an important relationship</li><li>Recording a meaningful connection between two people</li></ul>
        <p className="muted">The first version will calculate this after invitation and connection tracking are active.</p>
      </section>}
    </main>
  );
}
