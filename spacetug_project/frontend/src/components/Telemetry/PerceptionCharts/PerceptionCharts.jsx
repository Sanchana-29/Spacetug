import { usePerception } from "../../../context/PerceptionContext";
import StaticLineChart from "../StaticLineChart";
import "./PerceptionCharts.css";

const RAW = "#64748b";
const FILT = "#38bdf8";
const GT = "#a78bfa";

const rmse = (rows, a, b) => {
  const d = rows.filter((r) => r[a] != null && r[b] != null).map((r) => (r[a] - r[b]) ** 2);
  return d.length ? Math.sqrt(d.reduce((x, y) => x + y, 0) / d.length) : null;
};
const f = (v, d = 4) => (v == null ? "--" : Number(v).toFixed(d));

function ChartCard({ title, subtitle, data, lines, units, footer }) {
  return (
    <div className="chart-card perception-chart">
      <div className="chart-header">
        <h3>{title}</h3>
        <span className="pc-sub">{subtitle}</span>
      </div>
      <div className="pc-chart-body">
        <StaticLineChart data={data} lines={lines} yLabel={title} yUnits={units} />
      </div>
      {footer && <div className="pc-footer">{footer}</div>}
    </div>
  );
}

/** Estimated (raw), Kalman-filtered and ground-truth relative motion from the live perception loop. */
function PerceptionCharts() {
  const { history, latest } = usePerception();

  if (!history.length) {
    return (
      <div className="chart-card perception-empty">
        <h3>Estimated vs Ground Truth (Live Perception)</h3>
        <p>
          No perception samples yet. Open the <b>Sensors</b> page, start the simulation and press{" "}
          <b>▶ START LIVE PERCEPTION</b>. Pose, Kalman-filtered relative motion and collision risk will be plotted here
          against the simulation ground truth.
        </p>
      </div>
    );
  }

  const c = latest?.collision?.estimated;
  const lines3 = (k) => [
    { key: `${k}Raw`, color: RAW, label: "Estimated (raw)", dash: "4 3" },
    { key: `${k}Filt`, color: FILT, label: "Estimated (Kalman)" },
    { key: `${k}GT`, color: GT, label: "Ground truth" },
  ];

  return (
    <>
      <ChartCard
        title="Range: estimated vs truth"
        subtitle="solvePnP range and Kalman-filtered range (m)"
        data={history}
        lines={lines3("range")}
        units="m"
        footer={`RMSE raw ${f(rmse(history, "rangeRaw", "rangeGT"))} m · filtered ${f(rmse(history, "rangeFilt", "rangeGT"))} m`}
      />
      <ChartCard
        title="Relative speed: estimated vs truth"
        subtitle="|v| in a non-rotating frame (m/s)"
        data={history}
        lines={lines3("speed")}
        units="m/s"
        footer={`RMSE raw ${f(rmse(history, "speedRaw", "speedGT"))} m/s · filtered ${f(rmse(history, "speedFilt", "speedGT"))} m/s`}
      />
      <ChartCard
        title="Tumbling rate: estimated vs truth"
        subtitle="|ω| of the target (deg/s)"
        data={history}
        lines={lines3("tumble")}
        units="°/s"
        footer={`RMSE raw ${f(rmse(history, "tumbleRaw", "tumbleGT"), 3)} °/s · filtered ${f(rmse(history, "tumbleFilt", "tumbleGT"), 3)} °/s`}
      />
      <ChartCard
        title="Collision risk: CPA distance"
        subtitle={`Current: ${c?.risk_level || "--"} · TTC ${c ? (c.ttc_s == null ? "∞" : `${c.ttc_s} s`) : "--"} · t_CPA ${c?.t_cpa_s ?? "--"} s`}
        data={history}
        lines={[
          { key: "dcpa", color: FILT, label: "d_CPA estimated" },
          { key: "dcpaGT", color: GT, label: "d_CPA truth" },
        ]}
        units="m"
      />
    </>
  );
}

export default PerceptionCharts;
