"""Phase 2 tests: reference library, ORB/SIFT feature pose, identification (synthetic rendered views)."""
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv.features as F  # noqa: E402
from synthetic_render import render, look_at_pose, intrinsics, gt_dict  # noqa: E402

W, H = 1280, 720
K = intrinsics(W, H)


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    F.FEATURE_DB_DIR = tmp_path_factory.mktemp("feature_db")
    F._db_cache.clear()
    for yaw in range(0, 360, 30):
        for pitch in (-20, 15):
            R, t = look_at_pose(1.2, yaw, pitch)
            r = F.add_reference_view(render(R, t, K, W, H), K, gt_dict(R, t), f"v{yaw}_{pitch}")
            assert r["success"]
    return F.library_status()


def test_lifted_points_reproject_exactly():
    R, t = look_at_pose(1.2, 30, 10)
    img = render(R, t, K, W, H)
    import cv2
    kps = cv2.ORB_create(1000).detect(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), None)
    pts = np.array([k.pt for k in kps])
    X, idx = F.lift_keypoints_to_3d(pts, K, R, t, (W, H))
    assert len(idx) > 0.7 * len(pts)
    pr = (K @ ((R @ X.T).T + t).T).T
    pr = pr[:, :2] / pr[:, 2:]
    assert np.median(np.linalg.norm(pr - pts[idx], axis=1)) < 1e-6


def test_library_has_points(library):
    assert library["views"] == 24
    assert library["methods"]["ORB"]["points"] > 1000
    assert library["methods"]["SIFT"]["points"] > 500


def test_duplicate_view_rejected(library):
    R, t = look_at_pose(1.2, 0, -20)
    r = F.add_reference_view(render(R, t, K, W, H), K, gt_dict(R, t), "v0_-20")
    assert r["success"] is False


@pytest.mark.parametrize("feature", ["ORB", "SIFT"])
def test_feature_pose_on_new_view(library, feature):
    R, t = look_at_pose(1.1, 15, -15, offset=(0.05, -0.03))  # not a reference view
    r = F.estimate_pose_from_image(render(R, t, K, W, H), K, feature=feature,
                                   ground_truth=gt_dict(R, t), return_visualization=True)
    assert r["identified"], r["message"]
    assert r["errors_vs_gt"]["rotation_error_deg"] < 3.0
    assert r["errors_vs_gt"]["translation_error_pct"] < 2.0
    assert r["match_image"].startswith("data:image/jpeg;base64,")


def test_empty_frame_is_not_identified(library):
    blank = np.zeros((H, W, 3), np.uint8)
    r = F.estimate_pose_from_image(blank, K, feature="ORB", return_visualization=False)
    assert r["success"] is False and r["identified"] is False


def test_leave_one_out_excludes_view(library):
    R, t = look_at_pose(1.2, 0, -20)
    img = render(R, t, K, W, H)
    with_self = F.estimate_pose_from_image(img, K, feature="ORB", return_visualization=False)
    without = F.estimate_pose_from_image(img, K, feature="ORB", exclude_view_id="v0_-20",
                                         return_visualization=False)
    assert with_self["reference_points"] > without["reference_points"]


def test_empty_library_reports_clearly(tmp_path):
    old = F.FEATURE_DB_DIR
    F.FEATURE_DB_DIR = tmp_path
    F._db_cache.clear()
    try:
        r = F.estimate_pose_from_image(np.zeros((H, W, 3), np.uint8), K, return_visualization=False)
        assert r["success"] is False and "library is empty" in r["message"].lower()
    finally:
        F.FEATURE_DB_DIR = old
        F._db_cache.clear()
