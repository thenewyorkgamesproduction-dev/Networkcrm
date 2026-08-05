"use client";

import { useState } from "react";

type Report = {
  source?: { spreadsheet?: string; exported_at?: string };
  imported?: Record<string, number>;
  skipped?: Record<string, number>;
  errors?: Array<{ table: string; message: string }>;
  validation?: Record<
    string,
    { source: number; database: number; matches: boolean }
  >;
};

export default function MigrationPage() {
  const [secret, setSecret] = useState("");
  const [exportData, setExportData] = useState<unknown>(null);
  const [filename, setFilename] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  async function readFile(file?: File) {
    if (!file) return;
    setReport(null);
    setStatus("Reading export…");
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.format !== "network-crm-sheets-export") {
        throw new Error("That file is not a Network CRM export.");
      }
      setExportData(parsed);
      setFilename(file.name);
      setStatus("Export ready to import.");
    } catch (error) {
      setExportData(null);
      setFilename("");
      setStatus(error instanceof Error ? error.message : "Could not read file.");
    }
  }

  async function migrate() {
    if (!secret || !exportData) return;
    setBusy(true);
    setReport(null);
    setStatus("Importing data into Supabase. Keep this page open…");
    try {
      const response = await fetch("/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, export: exportData }),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Migration failed.");
      setReport(result.report);
      setStatus("Migration finished. Review the validation report below.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Migration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <p style={{ fontWeight: 800, letterSpacing: 1, fontSize: 12 }}>
        PRIVATE ADMIN TOOL
      </p>
      <h1>Move Network CRM to Supabase</h1>
      <p>
        This imports a Google Sheets backup while preserving contact, memory,
        list, connection, and event IDs. It does not delete anything from Sheets.
      </p>

      <section style={{ display: "grid", gap: 16, marginTop: 32 }}>
        <label>
          <strong>Migration secret</strong>
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            style={{ display: "block", width: "100%", padding: 12, marginTop: 8 }}
          />
        </label>

        <label>
          <strong>Sheets export file</strong>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => readFile(event.target.files?.[0])}
            style={{ display: "block", marginTop: 8 }}
          />
        </label>

        {filename && <p>Selected: {filename}</p>}

        <button
          onClick={migrate}
          disabled={!secret || !exportData || busy}
          style={{ padding: 14, fontWeight: 800, cursor: "pointer" }}
        >
          {busy ? "Importing…" : "Import into Supabase"}
        </button>

        {status && <p>{status}</p>}
      </section>

      {report && (
        <section style={{ marginTop: 36 }}>
          <h2>Validation report</h2>
          <p>
            Source: {report.source?.spreadsheet || "Unknown spreadsheet"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Table</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Source</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Database</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.validation || {}).map(([table, row]) => (
                  <tr key={table}>
                    <td style={{ padding: 10 }}>{table}</td>
                    <td style={{ textAlign: "right", padding: 10 }}>{row.source}</td>
                    <td style={{ textAlign: "right", padding: 10 }}>{row.database}</td>
                    <td style={{ padding: 10 }}>{row.matches ? "Matched" : "Review"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!report.errors?.length && (
            <>
              <h3>Errors</h3>
              {report.errors.map((error, index) => (
                <p key={`${error.table}-${index}`}>
                  {error.table}: {error.message}
                </p>
              ))}
            </>
          )}
        </section>
      )}
    </main>
  );
}
