import GoalsPanel from "./GoalsPanel";
import SettingsPanel from "./SettingsPanel";
import SourceTabs from "../SourceTabs";

export const dynamic = "force-dynamic";

// Everything you change about a client, in one place. Goals and Settings used to be two
// separate routes reached from two different links; an account manager setting a goal almost
// always wants to check the source that feeds it, and was made to navigate away to do it.
// Old links keep working: /goals and /settings redirect here with the matching tab open.
export default async function ManageClient({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  return (
    <>
      <h1 style={{ fontSize: 18, margin: "0 0 2px" }}>Manage {slug}</h1>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
        Goals and objectives, and the sources that feed them.
      </p>
      <SourceTabs label="Manage" tabs={[
        { key: "goals", label: "Goals & objectives", hasData: true },
        { key: "settings", label: "Sources & settings", hasData: true },
      ]}>
        {[
          <GoalsPanel key="goals" params={params} searchParams={searchParams} />,
          <SettingsPanel key="settings" params={params} searchParams={searchParams} />,
        ]}
      </SourceTabs>
    </>
  );
}
