"use client";
import { useEffect } from "react";
export default function ReportError({ error, reset }) {
  useEffect(() => { console.error('Report loading failed', error); }, [error]);
  return <div role="alert" className="card" style={{ margin: 24, maxWidth: 600 }}>
    <h2>We couldn’t load this report</h2>
    <p>No performance conclusions are available until the data loads successfully.</p>
    <button onClick={() => reset()}>Try again</button> <a href="/clients">Back to clients</a>
  </div>;
}
