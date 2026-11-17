"""
Phase 4 - Relative motion estimation from consecutive 6-DoF poses.

Frames
------
solvePnP gives the target pose in the (rotating) camera frame. The chaser knows
its own attitude (star tracker / IMU; in the simulation: camera world rotation),
so every measurement is rotated into a NON-ROTATING, world-aligned frame before
filtering. This makes relative velocity and angular rate physically meaningful
(otherwise the camera's own slewing would look like target motion).

  r_w   = R_cam_world @ C @ t_cv              (relative position, metres)
  R_tw  = R_cam_world @ C @ R_cv              (target attitude in world axes)
  C = diag(1,-1,-1): OpenCV camera axes -> Three.js camera axes

Filters
-------
* Translation: Kalman filter, constant-velocity model, state [r, v] (6).
* Rotation: angular velocity from consecutive attitudes,
      dR = R_k R_{k-1}^T = exp([w] dt)  ->  w = rotvec(dR) / dt   (world frame)
  smoothed with a Kalman filter on w (random-walk model, 3 states).
Outputs both RAW (finite differences) and FILTERED values.
"""
from __future__ import annotations

import math
from typing import Optional

import cv2
import numpy as np

C_CV_TO_THREE = np.diag([1.0, -1.0, -1.0])


def to_world(R_cv: np.ndarray, t_cv: np.ndarray, R_cam_world: Optional[np.ndarray]):
    """Express a camera-frame pose (OpenCV) in world-aligned axes."""
    Rcw = np.eye(3) if R_cam_world is None else np.asarray(R_cam_world, dtype=float).reshape(3, 3)
    r_w = Rcw @ C_CV_TO_THREE @ np.asarray(t_cv, dtype=float).reshape(3)
    R_tw = Rcw @ C_CV_TO_THREE @ np.asarray(R_cv, dtype=float).reshape(3, 3)
    return R_tw, r_w


def angular_velocity(R_prev: np.ndarray, R_curr: np.ndarray, dt: float) -> np.ndarray:
    """World-frame angular velocity (rad/s) that rotates R_prev into R_curr in dt seconds."""
    dR = R_curr @ R_prev.T
    rvec, _ = cv2.Rodrigues(dR)
    return rvec.reshape(3) / dt


class TranslationKF:
    def __init__(self, accel_noise: float = 0.02):
        self.q = accel_noise  # m/s^2 (white acceleration noise)
        self.x = None
        self.P = None

    def step(self, z: np.ndarray, dt: float, meas_sigma: float):
        if self.x is None:
            self.x = np.concatenate([z, np.zeros(3)])
            self.P = np.diag([meas_sigma ** 2] * 3 + [1.0] * 3)
            return self.x.copy()
        F = np.eye(6)
        F[:3, 3:] = np.eye(3) * dt
        G = np.vstack([np.eye(3) * 0.5 * dt * dt, np.eye(3) * dt])
        Q = G @ G.T * self.q ** 2
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + Q
        H = np.hstack([np.eye(3), np.zeros((3, 3))])
        R = np.eye(3) * meas_sigma ** 2
        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)
        self.x = self.x + K @ (z - H @ self.x)
        self.P = (np.eye(6) - K @ H) @ self.P
        return self.x.copy()


class RateKF:
    """Random-walk Kalman filter on angular velocity (3 states)."""

    def __init__(self, rate_noise: float = 0.002):
        self.q = rate_noise  # rad/s^2
        self.x = None
        self.P = None

    def step(self, z: np.ndarray, dt: float, meas_sigma: float):
        if self.x is None:
            self.x = z.copy()
            self.P = np.eye(3) * meas_sigma ** 2
            return self.x.copy()
        self.P = self.P + np.eye(3) * (self.q * dt) ** 2
        S = self.P + np.eye(3) * meas_sigma ** 2
        K = self.P @ np.linalg.inv(S)
        self.x = self.x + K @ (z - self.x)
        self.P = (np.eye(3) - K) @ self.P
        return self.x.copy()


class MotionEstimator:
    """Feed it timestamped poses; get raw + filtered relative motion."""

    def __init__(self, filtered: bool = True, pos_sigma_frac: float = 0.01,
                 rot_sigma_deg: float = 1.0):
        self.filtered = filtered
        self.pos_sigma_frac = pos_sigma_frac
        self.rot_sigma = math.radians(rot_sigma_deg)
        self.kf_t = TranslationKF()
        self.kf_w = RateKF()
        self.prev = None  # (time, R_tw, r_w)

    def reset(self):
        self.__init__(self.filtered, self.pos_sigma_frac, math.degrees(self.rot_sigma))

    def update(self, t: float, R_cv, t_cv, R_cam_world=None) -> Optional[dict]:
        R_tw, r_w = to_world(R_cv, t_cv, R_cam_world)
        rng = float(np.linalg.norm(r_w))
        out = {"time": float(t), "range_m": rng, "position_world": r_w.tolist()}

        if self.prev is not None and t < self.prev[0] - 1e-6:
            # simulation time went backwards (mission reset / reload): start over
            self.reset()
        if self.prev is None or t <= self.prev[0]:
            if self.prev is None:
                self.prev = (t, R_tw, r_w)
                if self.filtered:
                    self.kf_t.step(r_w, 1.0, max(0.003, self.pos_sigma_frac * rng))
            return {**out, "ready": False}

        dt = t - self.prev[0]
        v_raw = (r_w - self.prev[2]) / dt
        w_raw = angular_velocity(self.prev[1], R_tw, dt)
        self.prev = (t, R_tw, r_w)

        res = {
            **out, "ready": True, "dt": dt,
            "velocity_raw": v_raw.tolist(),
            "speed_raw_mps": float(np.linalg.norm(v_raw)),
            "closing_speed_raw_mps": float(-(r_w @ v_raw) / max(rng, 1e-9)),
            "angular_velocity_raw": w_raw.tolist(),
            "tumbling_rate_raw_dps": math.degrees(float(np.linalg.norm(w_raw))),
        }
        if self.filtered:
            sig_p = max(0.003, self.pos_sigma_frac * rng)
            x = self.kf_t.step(r_w, dt, sig_p)
            w_f = self.kf_w.step(w_raw, dt, math.sqrt(2) * self.rot_sigma / dt)
            r_f, v_f = x[:3], x[3:]
            res.update({
                "position_filtered": r_f.tolist(),
                "range_filtered_m": float(np.linalg.norm(r_f)),
                "velocity_filtered": v_f.tolist(),
                "speed_filtered_mps": float(np.linalg.norm(v_f)),
                "closing_speed_filtered_mps": float(-(r_f @ v_f) / max(np.linalg.norm(r_f), 1e-9)),
                "angular_velocity_filtered": w_f.tolist(),
                "tumbling_rate_filtered_dps": math.degrees(float(np.linalg.norm(w_f))),
            })
        return res
