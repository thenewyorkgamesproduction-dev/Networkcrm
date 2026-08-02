"use client";

import { useEffect, useState } from "react";

type Tab = "remember" | "search" | "import" | "health";
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

function copy(value?: string) {
  if (value) navigator.clipboard.writeText(value);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("remember");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [bulk, setBulk] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (tab !== "search") return;
    const value = query.trim();
    if (!value) {
      setResults([]);
      setStatus("");
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearching(true);
      setStatus("");
      try {
        const data = await crm("search_network", { query: value, limit: 40 });
        setResults(data || []);
        setStatus(`${(data || []).length} people found`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [query, tab]);

  async function remember() {
    if (!note.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const data = await crm("capture_note", { text: note, source: "web remember" });
      const name = data?.person?.name || data?.person?.phone || "person";
      setStatus(`Saved to ${name} ✓`);
      setNote("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function importLines() {
    const lines = bulk.split("\n").map(x => x.trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy(true);
    setStatus("");
    try {
      const data = await crm("bulk_capture", { lines, source: "bulk paste" });
      setStatus(`Processed ${data?.processed || lines.length} contacts ✓`);
      setBulk("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadFollowups() {
    setBusy(true);
    setStatus("");
    try {
      setFollowups(await crm("get_followups", { status: "Open", limit: 100 }) || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load follow-ups");
    } finally {
      setBusy(false);
    }
  }

  async function complete(id: string) {
    await crm("complete_followup", { followup_id: id });
    setFollowups(current => current.filter(item => item.followup_id !== id));
  }

  function openTab(next: Tab) {
    setTab(next);
    setStatus("");
    if (next === "health") loadFollowups();
  }

  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">PRIVATE NETWORK OS</p><h1>Network</h1></div>
        <nav>
          <button className={tab === "remember" ? "active" : ""} onClick={() => openTab("remember")}>Remember</button>
          <button className={tab === "search" ? "active" : ""} onClick={() => openTab("search")}>Search</button>
          <button className={tab === "import" ? "active" : ""} onClick={() => openTab("import")}>Import</button>
          <button className={tab === "health" ? "active" : ""} onClick={() => openTab("health")}>Health</button>
        </nav>
      </header>

      {tab === "remember" && <section className="hero card">
        <div className="mode">Remember</div>
        <h2>What do you want to remember?</h2>
        <p className="muted">Brain-dump the story. Names, numbers, handles, interests, context, and promises can all live in one sentence.</p>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Jane likes poker and wants to come to game night\n\nChloe is a founder, close friends with Kieran, and would be great for creator coworking" />
        <div className="commandFooter"><span>{note.length} characters</span><button className="primary" disabled={!note.trim() || busy} onClick={remember}>{busy ? "Saving…" : "Remember"}</button></div>
        {status && <p className="status">{status}</p>}
      </section>}

      {tab === "search" && <>
        <section className="card searchPanel">
          <div className="mode">Search</div>
          <h2>Search your network</h2>
          <input className="searchInput" autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="poker, coworking, founders, who likes Werewolf…" />
          <div className="searchMeta"><span>{searching ? "Searching…" : status || "Results update as you type"}</span></div>
        </section>

        {query.trim() && !searching && results.length === 0 && <div className="empty card">No matches yet. Try a broader topic or remember someone with this interest.</div>}

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

      {tab === "health" && <section>
        <section className="card health">
          <p className="eyebrow">GAMIFICATION</p><h2>Network Health</h2><div className="healthScore">—</div>
          <p>Your score will reward useful behavior rather than busywork:</p>
          <ul><li>Logging context about someone</li><li>Adding missing phone or Instagram information</li><li>Inviting a strong-fit person</li><li>Following up with an important relationship</li><li>Recording a meaningful connection between two people</li></ul>
        </section>
        <div className="sectionTitle"><div><p className="eyebrow">RELATIONSHIP MOMENTUM</p><h2>Open follow-ups</h2></div><button onClick={loadFollowups}>Refresh</button></div>
        {!followups.length && <div className="empty card">Nothing due right now.</div>}
        {followups.map(item => <article className="task card" key={item.followup_id}><div><h3>{item.person?.name || item.person?.phone || "Unknown person"}</h3><p>{item.task}</p><small>{item.due_date || "No due date"}</small></div><button onClick={() => complete(item.followup_id)}>Done</button></article>)}
      </section>}
    </main>
  );
}
