// Skeleton for client pages — renders inside the client layout (shell + title stay),
// placeholder KPI cards + table rows while the data loads.
export default function LoadingClient() {
  return (
    <>
      <div className="skel" style={{ height: 14, width: 260, margin: "10px 0 14px" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 18 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 92 }} />)}
      </div>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skel" style={{ height: 38, marginBottom: 8 }} />)}
    </>
  );
}
