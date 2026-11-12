import { useState } from "react";
import { FaInfoCircle, FaChevronLeft } from "react-icons/fa";

import TopBar from "../TopBar/TopBar";
import Sidebar from "../Sidebar/Sidebar";
import ObjectInspector from "../ObjectInspector/ObjectInspector";
import BottomControls from "../BottomControls/BottomControls";

import "./Layout.css";

function Layout({
  children,
  showInspector = true,
  showFooter = true,
  defaultInspectorOpen = false,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(defaultInspectorOpen);

  const isInspectorVisible = showInspector && inspectorOpen;

  return (
    <div
      className={`
        layout
        ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}
        ${isInspectorVisible ? "with-inspector" : "without-inspector"}
        ${showFooter ? "with-footer" : "without-footer"}
      `}
    >
      {/* TOP BAR */}
      <header className="topbar">
        <TopBar />
      </header>

      {/* SIDEBAR */}
      <aside className="sidebar">
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
      </aside>

      {/* MAIN CONTENT */}
      <main className="content">
        {children}

        {/* Pinned Edge Toggle Button when Object Inspector is collapsed */}
        {showInspector && !inspectorOpen && (
          <button
            type="button"
            className="inspector-edge-toggle"
            onClick={() => setInspectorOpen(true)}
            title="Open Object Inspector (Distance, Position, Attitude, Rotational Dynamics)"
          >
            <FaInfoCircle className="inspector-toggle-icon" />
            <span className="inspector-toggle-label">OBJECT INSPECTOR</span>
            <FaChevronLeft className="inspector-toggle-arrow" />
          </button>
        )}
      </main>

      {/* OBJECT INSPECTOR (Collapsible Telemetry Drawer) */}
      {isInspectorVisible && (
        <aside className="inspector">
          <ObjectInspector onClose={() => setInspectorOpen(false)} />
        </aside>
      )}

      {/* BOTTOM CONTROLS */}
      {showFooter && (
        <footer className="footer">
          <BottomControls />
        </footer>
      )}
    </div>
  );
}

export default Layout;
