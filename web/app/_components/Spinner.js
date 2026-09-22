// Small monochrome spinner. Used next to a control that has just triggered a server round trip,
// so the wait is visibly the app working rather than the app ignoring the click.
export default function Spinner({ size = 14, label = "Loading" }) {
  return (
    <span role="status" aria-label={label} style={{ display: "inline-flex", alignItems: "center" }}>
      <span className="spinner" style={{ width: size, height: size }} />
    </span>
  );
}
