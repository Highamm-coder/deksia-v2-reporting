// Route-transition skeleton for top-level pages (AppShell renders per-page, so this
// draws the same frame shape with placeholder blocks — no blank dark screen).
export default function Loading() {
  return (
    <div className="page">
      <div className="app">
        <aside className="sidebar">
          <div className="skel" style={{ height: 28, width: 110, margin: "8px 10px 16px" }} />
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 36 }} />)}
          <div className="grow" />
          <div className="skel" style={{ height: 64 }} />
        </aside>
        <div className="content">
          <main>
            <div className="skel" style={{ height: 16, width: 220, marginBottom: 16 }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 20 }}>
              {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 84 }} />)}
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 40, marginBottom: 8 }} />)}
          </main>
        </div>
      </div>
    </div>
  );
}
