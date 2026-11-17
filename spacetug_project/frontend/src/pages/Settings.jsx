import { useState } from "react";
import { FaSlidersH, FaSatellite, FaFileAlt, FaCheckCircle, FaExclamationCircle } from "react-icons/fa";
import Layout from "../components/Layout/Layout";
import GeneralSettings from "../components/Settings/GeneralSettings/GeneralSettings";
import SatelliteModel from "../components/Settings/SatelliteModel/SatelliteModel";
import MissionReport from "../components/Settings/MissionReport/MissionReport";
import "./Settings.css";

const TABS = [
  { id: "settings", label: "Settings", icon: FaSlidersH },
  { id: "model", label: "Target satellite model", icon: FaSatellite },
  { id: "report", label: "Mission report", icon: FaFileAlt },
];

function Settings() {
  const [tab, setTab] = useState("settings");
  const [toast, setToast] = useState(null);

  const notify = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="st-page">
        <header className="st-header">
          <div>
            <h2>Settings & Mission Report</h2>
            <p>Perception settings, the SAT-001 target model, and a downloadable summary of everything done in this mission.</p>
          </div>
          <nav className="st-tabs">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                <Icon /> {label}
              </button>
            ))}
          </nav>
        </header>

        {toast && (
          <div className={`st-toast ${toast.type}`}>
            {toast.type === "error" ? <FaExclamationCircle /> : <FaCheckCircle />} {toast.message}
          </div>
        )}

        {tab === "settings" && <GeneralSettings notify={notify} />}
        {tab === "model" && <SatelliteModel />}
        {tab === "report" && <MissionReport notify={notify} />}
      </div>
    </Layout>
  );
}

export default Settings;
