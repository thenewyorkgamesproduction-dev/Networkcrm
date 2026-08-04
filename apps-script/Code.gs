/** Network CRM Apps Script backend v2. Attach this script to the CRM Google Sheet. */
const CRM_VERSION = '2026-08-03-search-v2';
const SHEETS = {
  PEOPLE: 'People', MEMORIES: 'Memories', SIGNALS: 'Signals',
  FOLLOWUPS: 'FollowUps', OPPORTUNITIES: 'Opportunities',
  CONNECTIONS: 'Connections', SETTINGS: 'Settings'
};
const HEADERS = {
  People: ['person_id','name','phone','email','instagram','company','role','where_met','summary','importance','importance_reason','last_contact','created_at'],
  Memories: ['memory_id','person_id','date','raw_note','topics','event','source'],
  Signals: ['signal_id','person_id','topic','signal_type','strength','confidence','evidence','source_memory_id','created_at'],
  FollowUps: ['followup_id','person_id','task','due_date','status','notes'],
  Opportunities: ['opportunity_id','person_id','title','type','stage','next_action','due_date','estimated_value','notes'],
  Connections: ['connection_id','person_a_id','person_b_id','relationship','strength','notes','created_at'],
  Settings: ['key','value','notes']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('People CRM')
    .addItem('Initialize / Repair Sheets', 'initializeCrm')
    .addItem('Generate API Key', 'generateApiKey')
    .addItem('Show API Key', 'showApiKey')
    .addToUi();
}

function initializeCrm() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    const headers = HEADERS[name];
    const current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((h, i) => current[i] !== h)) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  SpreadsheetApp.getUi().alert('CRM sheets are ready. Version: ' + CRM_VERSION);
}

function generateApiKey() {
  const key = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('CRM_API_KEY', key);
  SpreadsheetApp.getUi().alert('API key created.');
}
function showApiKey() {
  SpreadsheetApp.getUi().alert(PropertiesService.getScriptProperties().getProperty('CRM_API_KEY') || 'No API key found.');
}
function doGet() {
  return jsonResponse({ ok: true, service: 'Network CRM', version: CRM_VERSION });
}
function doPost(e) {
  try {
    const body = parseBody(e);
    authenticate(body.api_key);
    const p = body.payload || {};
    const handlers = {
      capture_note: () => captureNote(p),
      bulk_capture: () => bulkCapture(p),
      search_network: () => searchNetwork(p),
      get_followups: () => getFollowups(p),
      complete_followup: () => completeFollowup(p),
      create_opportunity: () => createOpportunity(p),
      create_connection: () => createConnection(p),
      get_person: () => getPerson(p),
      diagnostics: () => diagnostics()
    };
    if (!handlers[body.action]) throw new Error('Unknown action: ' + body.action);
    return jsonResponse({ ok: true, action: body.action, version: CRM_VERSION, data: handlers[body.action]() });
  } catch (err) {
    return jsonResponse({ ok: false, version: CRM_VERSION, error: String(err.message || err) });
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Missing JSON body.');
  return JSON.parse(e.postData.contents);
}
function authenticate(candidate) {
  const expected = PropertiesService.getScriptProperties().getProperty('CRM_API_KEY');
  if (!expected) throw new Error('API key not configured.');
  if (candidate !== expected) throw new Error('Unauthorized.');
}
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name) {
  const sh = ss().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet ' + name + '. Run initializeCrm.');
  return sh;
}
function rows(name) {
  const values = sheet(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => obj[h] = row[j]);
    return obj;
  }).filter(obj => headers.some(h => obj[h] !== ''));
}
function append(name, obj) {
  const sh = sheet(name), headers = HEADERS[name];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { sh.appendRow(headers.map(h => sanitize(obj[h] === undefined ? '' : obj[h]))); }
  finally { lock.releaseLock(); }
  return obj;
}
function update(name, rowNumber, patch) {
  const sh = sheet(name), headers = HEADERS[name];
  const current = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => { if (Object.prototype.hasOwnProperty.call(patch, h)) current[i] = sanitize(patch[h]); });
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
}
function sanitize(v) {
  if (Array.isArray(v)) v = v.join(', ');
  if (v && typeof v === 'object' && !(v instanceof Date)) v = JSON.stringify(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}
function id(prefix) { return prefix + '_' + Utilities.getUuid(); }
function now() { return new Date().toISOString(); }
function norm(v) { return String(v || '').replace(/^'/, '').trim().toLowerCase(); }
function digits(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
function clean(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (k !== '_row') out[k] = obj[k]; });
  return out;
}
function sameId(a, b) { return String(a || '').trim() === String(b || '').trim(); }

function findPeople(p) {
  const all = rows(SHEETS.PEOPLE);
  if (p.person_id) return all.filter(x => sameId(x.person_id, p.person_id));
  const ph = digits(p.phone), ig = norm(p.instagram).replace(/^@/, ''), em = norm(p.email), name = norm(p.name || p.query);
  if (ph) { const m = all.filter(x => digits(x.phone) === ph); if (m.length) return m; }
  if (ig) { const m = all.filter(x => norm(x.instagram).replace(/^@/, '') === ig); if (m.length) return m; }
  if (em) { const m = all.filter(x => norm(x.email) === em); if (m.length) return m; }
  if (name) {
    const exact = all.filter(x => norm(x.name) === name);
    if (exact.length) return exact;
    const partial = all.filter(x => norm(x.name).includes(name) || name.includes(norm(x.name)));
    if (partial.length === 1) return partial;
  }
  return [];
}
function createPerson(p) {
  return append(SHEETS.PEOPLE, {
    person_id: id('person'), name: p.name || 'Unknown', phone: p.phone || '', email: p.email || '',
    instagram: p.instagram || '', company: p.company || '', role: p.role || '', where_met: p.where_met || '',
    summary: p.summary || '', importance: Number(p.importance || 0), importance_reason: p.importance_reason || '',
    last_contact: p.last_contact || '', created_at: now()
  });
}
function upsertPerson(p) {
  const matches = findPeople(p);
  if (matches.length > 1) return { ambiguous: true, matches: matches.map(clean) };
  if (!matches.length) return { created: true, person: createPerson(p) };
  const row = matches[0], patch = {};
  ['name','phone','email','instagram','company','role','where_met','summary','importance','importance_reason','last_contact'].forEach(k => {
    if (p[k] !== undefined && p[k] !== '' && p[k] !== 0) patch[k] = p[k];
  });
  update(SHEETS.PEOPLE, row._row, patch);
  return { updated: true, person: Object.assign(clean(row), patch) };
}

function captureNote(p) {
  const raw = String(p.text || p.raw_note || '').trim();
  if (!raw) throw new Error('capture_note needs text.');
  const parsed = parseCapture(raw);
  const result = upsertPerson(parsed);
  if (result.ambiguous) return { saved: false, ambiguous: true, matches: result.matches };
  const person = result.person;
  const memory = append(SHEETS.MEMORIES, {
    memory_id: id('memory'), person_id: person.person_id, date: now(), raw_note: raw,
    topics: parsed.topics.join(', '), event: parsed.where_met || '', source: p.source || 'capture'
  });
  parsed.signals.forEach(s => append(SHEETS.SIGNALS, {
    signal_id: id('signal'), person_id: person.person_id, topic: s.topic, signal_type: s.type,
    strength: s.strength, confidence: 'rule-based', evidence: raw,
    source_memory_id: memory.memory_id, created_at: now()
  }));
  if (parsed.followup) append(SHEETS.FOLLOWUPS, {
    followup_id: id('followup'), person_id: person.person_id, task: parsed.followup,
    due_date: '', status: 'Open', notes: raw
  });
  if (parsed.opportunity) append(SHEETS.OPPORTUNITIES, {
    opportunity_id: id('opp'), person_id: person.person_id, title: parsed.opportunity + ' opportunity',
    type: parsed.opportunity, stage: 'Potential', next_action: '', due_date: '', estimated_value: '', notes: raw
  });
  return { saved: true, person: person, memory: memory, signals: parsed.signals };
}
function bulkCapture(p) {
  const lines = Array.isArray(p.lines) ? p.lines : String(p.text || '').split('\n');
  const results = [];
  lines.map(x => String(x).trim()).filter(Boolean).forEach(line => {
    try { results.push(captureNote({ text: line, source: p.source || 'bulk' })); }
    catch (err) { results.push({ saved: false, error: String(err.message || err), raw: line }); }
  });
  return { processed: results.length, created_or_updated: results.filter(x => x.saved).length, results: results };
}
function parseCapture(text) {
  const lower = norm(text);
  const pm = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const ig = text.match(/@([A-Za-z0-9._]{2,30})/);
  const em = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  let cleaned = text.replace(pm ? pm[0] : '', ' ').replace(ig ? ig[0] : '', ' ').trim();
  const actionWords = /\b(likes?|loves?|wants?|works?|is|met|plays?|enjoys?|founder|creator|important|poker|werewolf|coworking|game night)\b/i;
  const actionIndex = cleaned.search(actionWords);
  if (actionIndex > 0) cleaned = cleaned.slice(0, actionIndex).trim();
  cleaned = cleaned.split(/[,;|\n]/)[0].trim();
  const name = /^[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*){0,3}$/.test(cleaned) ? cleaned : '';
  const catalog = ['werewolf','coworking','game night','games','poker','creator','content','founder','influencer','sponsor','sponsorship','partnership','marketing','volleyball','chess','filmmaker','youtube','instagram','tiktok'];
  const topics = catalog.filter(t => lower.includes(t));
  const signals = topics.map(topic => ({ topic: topic, type: /invite|wants to come|asked to come/.test(lower) ? 'invitation_interest' : 'interest', strength: strengthFor(lower, topic) }));
  const importance = /\b(vip|very important|top priority)\b/.test(lower) ? 5 : /\bimportant\b/.test(lower) ? 4 : 0;
  const followup = /\b(invite|follow up|send|call|text|email|reach out)\b/.test(lower) ? ((text.match(/\b(invite|follow up|send|call|text|email|reach out)[^.;]*/i) || [])[0] || 'Follow up') : '';
  const opportunity = /sponsor/.test(lower) ? 'Sponsorship' : /partnership/.test(lower) ? 'Partnership' : /collab|paid creator|deal/.test(lower) ? 'Collaboration' : '';
  return { name: name, phone: pm ? pm[0] : '', email: em ? em[0] : '', instagram: ig ? '@' + ig[1] : '', summary: text, importance: importance, importance_reason: importance ? text : '', last_contact: now(), topics: topics, signals: signals, followup: followup, opportunity: opportunity, where_met: '' };
}
function strengthFor(lower, topic) {
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('(really likes|loves|favorite|plays every week|obsessed with).{0,18}' + escaped + '|' + escaped + '.{0,18}(really likes|loves|favorite|every week|obsessed)', 'i').test(lower)) return 5;
  if (new RegExp('(wants|asked|down for|invite).{0,20}' + escaped + '|' + escaped + '.{0,20}(wants|asked|down for|invite)', 'i').test(lower)) return 4;
  if (new RegExp('(likes|enjoys|plays).{0,15}' + escaped + '|' + escaped + '.{0,15}(likes|enjoys|plays)', 'i').test(lower)) return 3;
  return 2;
}

function searchNetwork(p) {
  const query = norm(p.query);
  if (!query) throw new Error('search_network needs query.');
  const terms = query.split(/\s+/).filter(Boolean);
  const people = rows(SHEETS.PEOPLE), memories = rows(SHEETS.MEMORIES), signals = rows(SHEETS.SIGNALS), followups = rows(SHEETS.FOLLOWUPS), opps = rows(SHEETS.OPPORTUNITIES);
  const results = [];
  people.forEach(person => {
    const pid = String(person.person_id || '').trim();
    const pm = memories.filter(x => sameId(x.person_id, pid));
    const ps = signals.filter(x => sameId(x.person_id, pid));
    const pf = followups.filter(x => sameId(x.person_id, pid));
    const po = opps.filter(x => sameId(x.person_id, pid));
    const identityText = norm([person.name, person.phone, person.email, person.instagram, person.company, person.role, person.where_met, person.summary].join(' '));
    const memoryText = norm(pm.map(x => [x.raw_note, x.topics, x.event].join(' ')).join(' '));
    const signalText = norm(ps.map(x => [x.topic, x.signal_type, x.evidence].join(' ')).join(' '));
    const otherText = norm(po.map(x => [x.title, x.type, x.stage, x.notes].join(' ')).join(' ') + ' ' + pf.map(x => [x.task, x.notes].join(' ')).join(' '));
    const combined = [identityText, memoryText, signalText, otherText].join(' ');
    const matchedTerms = terms.filter(t => combined.includes(t));
    if (!matchedTerms.length) return;
    let score = matchedTerms.length * 10 + Number(person.importance || 0) * 2;
    const reasons = [];
    ps.forEach(s => {
      if (terms.some(t => norm(s.topic).includes(t) || t.includes(norm(s.topic)))) {
        score += Number(s.strength || 0) * 5;
        reasons.push(String(s.evidence || s.topic));
      }
    });
    if (!reasons.length) {
      const matchingMemory = pm.find(m => terms.some(t => norm([m.raw_note, m.topics].join(' ')).includes(t)));
      if (matchingMemory) reasons.push(String(matchingMemory.raw_note));
      else reasons.push('Matched ' + matchedTerms.join(', '));
    }
    results.push({
      score: score,
      person: clean(person),
      reasons: Array.from(new Set(reasons)).slice(0, 3),
      matching_memories: pm.filter(m => terms.some(t => norm([m.raw_note, m.topics].join(' ')).includes(t))).map(clean)
    });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, Number(p.limit || 40));
}

function diagnostics() {
  return { version: CRM_VERSION, people: rows(SHEETS.PEOPLE).length, memories: rows(SHEETS.MEMORIES).length, signals: rows(SHEETS.SIGNALS).length };
}
function getFollowups(p) {
  const status = norm(p.status || 'open');
  const index = {};
  rows(SHEETS.PEOPLE).forEach(x => index[String(x.person_id).trim()] = clean(x));
  return rows(SHEETS.FOLLOWUPS).filter(x => !status || norm(x.status) === status).map(x => Object.assign(clean(x), { person: index[String(x.person_id).trim()] || {} }));
}
function completeFollowup(p) {
  const item = rows(SHEETS.FOLLOWUPS).find(x => sameId(x.followup_id, p.followup_id));
  if (!item) throw new Error('Follow-up not found.');
  update(SHEETS.FOLLOWUPS, item._row, { status: 'Completed' });
  return Object.assign(clean(item), { status: 'Completed' });
}
function createOpportunity(p) {
  if (!p.title) throw new Error('title required');
  const person = findPeople(p)[0] || createPerson(p);
  return append(SHEETS.OPPORTUNITIES, { opportunity_id: id('opp'), person_id: person.person_id, title: p.title, type: p.type || 'Other', stage: p.stage || 'Potential', next_action: p.next_action || '', due_date: p.due_date || '', estimated_value: p.estimated_value || '', notes: p.notes || '' });
}
function createConnection(p) {
  const a = findPeople({ person_id: p.person_a_id, name: p.person_a_name, phone: p.person_a_phone })[0];
  const b = findPeople({ person_id: p.person_b_id, name: p.person_b_name, phone: p.person_b_phone })[0];
  if (!a || !b) throw new Error('Both people must exist.');
  return append(SHEETS.CONNECTIONS, { connection_id: id('connection'), person_a_id: a.person_id, person_b_id: b.person_id, relationship: p.relationship || 'Connected', strength: Number(p.strength || 3), notes: p.notes || '', created_at: now() });
}
function getPerson(p) {
  const matches = findPeople(p);
  if (matches.length !== 1) return { matches: matches.map(clean) };
  const person = clean(matches[0]), pid = person.person_id;
  return {
    person: person,
    memories: rows(SHEETS.MEMORIES).filter(x => sameId(x.person_id, pid)).map(clean),
    signals: rows(SHEETS.SIGNALS).filter(x => sameId(x.person_id, pid)).map(clean),
    followups: rows(SHEETS.FOLLOWUPS).filter(x => sameId(x.person_id, pid)).map(clean),
    opportunities: rows(SHEETS.OPPORTUNITIES).filter(x => sameId(x.person_id, pid)).map(clean),
    connections: rows(SHEETS.CONNECTIONS).filter(x => sameId(x.person_a_id, pid) || sameId(x.person_b_id, pid)).map(clean)
  };
}
