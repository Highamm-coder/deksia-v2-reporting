import Sidebar from "./Sidebar";

// Authenticated app frame: light page → dark rounded panel → left sidebar + content.
export default function AppShell({ children }) {
  return (
    <div className="page">
      <div className="app">
        <Sidebar />
        <div className="content">
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
