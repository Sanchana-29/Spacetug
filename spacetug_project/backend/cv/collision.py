"""
Phase 5 - Collision risk: Time To Collision (TTC) and Closest Point of Approach (CPA).

r = relative position of the target w.r.t. the chaser (m)
v = relative velocity (m/s), both in the same non-rotating frame.

  closing speed   c     = -(r . v) / |r|          (> 0 means the gap is shrinking)
  TTC                    = |r| / c   if c > 0, else infinity
  time to CPA     t_cpa = max(0, -(r . v) / |v|^2)
  CPA distance    d_cpa = | r + v * t_cpa |

Risk level
  HIGH   : d_cpa < safety_radius  and  t_cpa < horizon
  MEDIUM : d_cpa < 2 * safety_radius (and t_cpa < 2 * horizon)  or  current range < safety_radius
  LOW    : otherwise
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np


def assess_collision(r, v, safety_radius_m: float = 2.0, horizon_s: float = 60.0) -> dict:
    r = np.asarray(r, dtype=float).reshape(3)
    v = np.asarray(v, dtype=float).reshape(3)
    rng = float(np.linalg.norm(r))
    speed = float(np.linalg.norm(v))
    rv = float(r @ v)

    closing = -rv / rng if rng > 1e-9 else 0.0
    ttc = rng / closing if closing > 1e-6 else math.inf
    t_cpa = max(0.0, -rv / (speed * speed)) if speed > 1e-9 else 0.0
    d_cpa = float(np.linalg.norm(r + v * t_cpa))

    # Docking Corridor: when performing planned close proximity approach (e.g. range <= 5.0m)
    # with controlled low closing velocity (<= 0.25 m/s), designate as nominal "DOCKING CORRIDOR"
    # rather than flagging false-positive HIGH risk.
    if rng <= 5.0 and 0.0 < closing <= 0.25 and d_cpa < safety_radius_m:
        risk = "DOCKING CORRIDOR"
    elif d_cpa < safety_radius_m and t_cpa < horizon_s:
        risk = "HIGH"
    elif (d_cpa < 2.0 * safety_radius_m and t_cpa < 2.0 * horizon_s) or rng < safety_radius_m:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    def fin(x: float, nd=3) -> Optional[float]:
        return round(x, nd) if math.isfinite(x) else None

    return {
        "range_m": round(rng, 4),
        "relative_speed_mps": round(speed, 5),
        "closing_speed_mps": round(closing, 5),
        "ttc_s": fin(ttc, 2),              # None = not closing (infinite)
        "t_cpa_s": round(t_cpa, 2),
        "d_cpa_m": round(d_cpa, 4),
        "risk_level": risk,
        "safety_radius_m": safety_radius_m,
        "horizon_s": horizon_s,
    }
