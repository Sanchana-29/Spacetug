import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

import { WindowProvider } from "./context/WindowContext";
import { MissionProvider } from "./context/MissionContext";
import { SensorProvider } from "./context/SensorContext";
import { SimulationProvider } from "./context/SimulationContext";
import { PerceptionProvider } from "./context/PerceptionContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WindowProvider>
      <MissionProvider>
        <SensorProvider>
          <SimulationProvider>
            <PerceptionProvider>
              <App />
            </PerceptionProvider>
          </SimulationProvider>
        </SensorProvider>
      </MissionProvider>
    </WindowProvider>
  </React.StrictMode>
);