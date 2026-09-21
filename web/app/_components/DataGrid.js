"use client";
// DataGrid — the one way lists of records are shown in the console.
// Toolbar (search · per-column filters · sort · column picker) · selectable rows with a
// bulk-action bar · a kebab menu per row · count + pager in the header · one primary action.
// Monochrome: surfaces and rules from the design tokens; colour only inside cells.
//
// Server actions may be passed as props (bulk / row-menu actions); the grid submits them
// through plain <form>s so nothing here needs an API route.
//
// columns: [{ key, label, width?, align?, render?(row), sort?(row) → comparable, filter?: "select",
//             hidden?: boolean (default hidden) }]
// bulk:    [{ label, action (server action), tone?: "danger", fields?: (selectedRows) → node, confirm?: string }]
// rowMenu: (row) → [{ label, href } | { label, action, fields: {name: value}, tone? }]
import { useEffect, useMemo, useState } from "react";

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export default function DataGrid({
  id, title, rows = [], rowId = (r) => r.id, columns = [], search, pageSize = 25,
  bulk = [], rowMenu, primary, empty = "Nothing here.", initialSort, dense = false,
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(initialSort || { key: null, dir: "asc" });
  const [hidden, setHidden] = useState(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [openMenu, setOpenMenu] = useState(null);

  // remember column choices per grid, per person
  useEffect(() => { const saved = ls.get(`grid:${id}:hidden`, null); if (saved) setHidden(new Set(saved)); }, [id]);
  const toggleCol = (k) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); ls.set(`grid:${id}:hidden`, [...n]); return n; });
  useEffect(() => { const close = () => setOpenMenu(null); document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, []);

  const filterCols = useMemo(() => columns.filter((c) => c.filter === "select"), [columns]);
  const options = useMemo(() => Object.fromEntries(filterCols.map((c) => {
    const vals = new Set(rows.map((r) => (c.filterValue ? c.filterValue(r) : c.sort ? c.sort(r) : r[c.key])).filter((v) => v != null && v !== ""));
    return [c.key, [...vals].sort((a, b) => String(a).localeCompare(String(b)))];
  })), [rows, filterCols]);

  const shown = useMemo(() => {
    let out = rows;
    if (q.trim()) { const needle = q.trim().toLowerCase(); out = out.filter((r) => (search ? search(r) : JSON.stringify(r)).toLowerCase().includes(needle)); }
    for (const [k, v] of Object.entries(filters)) {
      if (v === "" || v == null) continue;
      const col = columns.find((c) => c.key === k);
      out = out.filter((r) => String(col?.filterValue ? col.filterValue(r) : col?.sort ? col.sort(r) : r[k]) === String(v));
    }
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r) => (col?.sort ? col.sort(r) : r[sort.key]);
      out = [...out].sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return sort.dir === "asc" ? c : -c; });
    }
    return out;
  }, [rows, q, filters, sort, columns, search]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages);
  const slice = shown.slice((cur - 1) * pageSize, cur * pageSize);
  const visCols = columns.filter((c) => !hidden.has(c.key));
  const allOnPage = slice.length > 0 && slice.every((r) => selected.has(rowId(r)));
  const selectedRows = rows.filter((r) => selected.has(rowId(r)));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); allOnPage ? slice.forEach((r) => n.delete(rowId(r))) : slice.forEach((r) => n.add(rowId(r))); return n; });
  const toggleOne = (r) => setSelected((s) => { const n = new Set(s); const k = rowId(r); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const th = (c) => {
    const sortable = c.sort || !c.render;
    return <th key={c.key} style={{ textAlign: c.align || "left", width: c.width }}
      aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      {sortable ? <button type="button" className="sort-button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
        {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button> : c.label}
    </th>;
  };

  return (
    <div className="grid">
      <div className="grid-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <span className="muted" style={{ fontSize: 12 }}>{shown.length.toLocaleString()}{shown.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ""} {shown.length === 1 ? "record" : "records"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {pages > 1 && (
            <span className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button type="button" className="grid-btn" aria-label="Previous page" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹</button>
              {cur} of {pages}
              <button type="button" className="grid-btn" aria-label="Next page" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>›</button>
            </span>
          )}
          {primary}
        </div>
      </div>

      <div className="grid-toolbar">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={`Search ${title || "records"}`} placeholder="Search…" className="grid-search" />
        {filterCols.map((c) => (
          <select key={c.key} aria-label={`Filter by ${c.label}`} value={filters[c.key] ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, [c.key]: e.target.value })); setPage(1); }} className="grid-select">
            <option value="">{c.label}: all</option>
            {(options[c.key] || []).map((v) => <option key={String(v)} value={String(v)}>{c.filterLabel ? c.filterLabel(v) : String(v)}</option>)}
          </select>
        ))}
        {(q || Object.values(filters).some(Boolean)) && (
          <button type="button" className="grid-btn" onClick={() => { setQ(""); setFilters({}); setPage(1); }}>Clear</button>
        )}
        <details className="grid-cols" onClick={(e) => e.stopPropagation()}>
          <summary className="grid-btn">Columns</summary>
          <div className="grid-pop">
            {columns.map((c) => (
              <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 13 }}>
                <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} style={{ width: "auto", margin: 0 }} /> {c.label}
              </label>
            ))}
          </div>
        </details>
      </div>

      {selected.size > 0 && bulk.length > 0 && (
        <div className="grid-bulk">
          <span style={{ fontWeight: 600, fontSize: 13 }}>{selected.size} selected</span>
          {bulk.map((b) => (
            <form key={b.label} action={b.action} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}
                  onSubmit={(e) => { if (b.confirm && !window.confirm(b.confirm)) e.preventDefault(); }}>
              {[...selected].map((k) => <input key={k} type="hidden" name="ids" value={k} />)}
              {b.fields ? b.fields(selectedRows) : null}
              <button type="submit" className={`grid-btn ${b.tone === "danger" ? "danger" : "solid"}`}>{b.label}</button>
            </form>
          ))}
          <button type="button" className="grid-btn" onClick={() => setSelected(new Set())} style={{ marginLeft: "auto" }}>Clear selection</button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className={dense ? "dense" : undefined}>
          <thead>
            <tr>
              {bulk.length > 0 && <th style={{ width: 34 }}><input type="checkbox" checked={allOnPage} onChange={toggleAll} style={{ width: "auto", margin: 0 }} aria-label="select page" /></th>}
              {visCols.map(th)}
              {rowMenu && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && <tr><td colSpan={visCols.length + 2} className="muted" style={{ textAlign: "center", padding: 22 }}>{empty}</td></tr>}
            {slice.map((r) => {
              const k = rowId(r); const menu = rowMenu ? rowMenu(r) : null;
              return (
                <tr key={k} id={`row-${k}`} className={selected.has(k) ? "sel" : undefined} style={r._style}>
                  {bulk.length > 0 && <td><input type="checkbox" aria-label={`Select record ${k}`} checked={selected.has(k)} onChange={() => toggleOne(r)} style={{ width: "auto", margin: 0 }} /></td>}
                  {visCols.map((c) => <td key={c.key} style={{ textAlign: c.align || "left", whiteSpace: c.wrap ? "normal" : undefined, fontSize: c.small ? 12 : undefined }} className={c.className}>{c.render ? c.render(r) : r[c.key]}</td>)}
                  {rowMenu && (
                    <td style={{ position: "relative", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      {menu && menu.length > 0 && (
                        <>
                          <button type="button" className="grid-btn kebab" aria-label="actions" onClick={() => setOpenMenu(openMenu === k ? null : k)}>⋮</button>
                          {openMenu === k && (
                            <div className="grid-pop" style={{ right: 8, left: "auto", minWidth: 180 }}>
                              {menu.map((m, i) => m.href
                                ? <a key={i} href={m.href} className="grid-item">{m.label}</a>
                                : <form key={i} action={m.action} style={{ margin: 0 }}>
                                    {Object.entries(m.fields || {}).map(([n, v]) => <input key={n} type="hidden" name={n} value={v ?? ""} />)}
                                    <button type="submit" className={`grid-item ${m.tone === "danger" ? "danger" : ""}`}>{m.label}</button>
                                  </form>)}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
