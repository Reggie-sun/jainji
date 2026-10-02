"""Geometry controls only; no required-pixel truth or real-media qualification."""
import importlib.util
from pathlib import Path
import unittest

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("geometry", Path(__file__).parents[1] / "scripts/shape-cover-static-geometry.py")
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def target():
    rng = np.random.default_rng(17)
    frame = np.full((80, 100, 4), 90, np.uint8)
    texture = rng.integers(45, 205, (44, 60), dtype=np.uint8)
    texture = cv2.GaussianBlur(texture, (3, 3), 0.5)
    frame[18:62, 20:80, :3] = texture[..., None]
    frame[..., 3] = 255
    return frame


class StaticGeometryTest(unittest.TestCase):
    def setUp(self):
        self.frame = target()
        self.box = {"x": 20, "y": 18, "width": 60, "height": 44}
        self.model = geometry.build_model(np.stack([self.frame] * 4), self.box)

    def measure(self, frame):
        return geometry.measure_frame(frame, self.model)

    def test_static_and_recompute(self):
        a, b = self.measure(self.frame), self.measure(self.frame.copy())
        self.assertEqual(a, b)
        self.assertEqual(a["state"], "STATIC_GEOMETRY_OBSERVED")
        self.assertEqual(a["globalOffset"], [0.0, 0.0])

    def test_rgb_outside_sample_envelope_is_not_geometry_motion(self):
        frame = self.frame.copy()
        frame[..., :3] = np.rint(frame[..., :3] * 0.8 + 55).astype(np.uint8)
        self.assertGreater(int(frame[22, 26, 0]) - int(self.frame[22, 26, 0]), 24)
        self.assertEqual(self.measure(frame)["state"], "STATIC_GEOMETRY_OBSERVED")

    def test_integer_translation_all_directions(self):
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (3, -2)]:
            with self.subTest(dx=dx, dy=dy):
                frame = cv2.warpAffine(self.frame, np.float32([[1, 0, dx], [0, 1, dy]]), (100, 80), borderMode=cv2.BORDER_REPLICATE)
                measured = self.measure(frame)
                self.assertIn("POSITION_DRIFT", measured["reasons"])
                self.assertEqual(measured["globalOffset"], [float(dx), float(dy)])

    def test_subpixel_translation(self):
        frame = cv2.warpAffine(self.frame, np.float32([[1, 0, 0.75], [0, 1, 0]]), (100, 80), borderMode=cv2.BORDER_REPLICATE)
        measured = self.measure(frame)
        self.assertIn("POSITION_DRIFT", measured["reasons"])
        self.assertGreaterEqual(measured["globalOffset"][0], 0.75)

    def test_declared_sensitivity_does_not_claim_subthreshold_motion_absent(self):
        frame = cv2.warpAffine(self.frame, np.float32([[1, 0, 0.5], [0, 1, 0]]), (100, 80), borderMode=cv2.BORDER_REPLICATE)
        measured = self.measure(frame)
        self.assertEqual(measured["globalOffset"], [0.5, 0.0])
        self.assertNotIn("POSITION_DRIFT", measured["reasons"])

    def test_small_noise_and_channel_bias_preserve_geometry(self):
        rng = np.random.default_rng(5)
        frame = self.frame.copy()
        frame[..., :3] = np.clip(frame[..., :3].astype(np.int16) + rng.integers(-2, 3, frame[..., :3].shape), 0, 255).astype(np.uint8)
        self.assertEqual(self.measure(frame)["state"], "STATIC_GEOMETRY_OBSERVED")
        frame[..., :3] = np.clip(self.frame[..., :3].astype(np.int16) + [-30, 20, 15], 0, 255).astype(np.uint8)
        self.assertEqual(self.measure(frame)["state"], "STATIC_GEOMETRY_OBSERVED")

    def test_disappearance_and_partial_occlusion(self):
        frame = self.frame.copy()
        frame[18:62, 20:80, :3] = 90
        measured = self.measure(frame)
        self.assertNotEqual(measured["state"], "STATIC_GEOMETRY_OBSERVED")
        self.assertIn("LANDMARK_LOSS_OR_OCCLUSION", measured["reasons"])
        frame = self.frame.copy()
        frame[18:62, 20:48, :3] = 90
        self.assertNotEqual(self.measure(frame)["state"], "STATIC_GEOMETRY_OBSERVED")

    def test_local_deformation(self):
        frame = self.frame.copy()
        frame[18:40, 20:50] = np.roll(frame[18:40, 20:50], 2, axis=1)
        measured = self.measure(frame)
        self.assertNotEqual(measured["state"], "STATIC_GEOMETRY_OBSERVED")
        self.assertTrue(set(measured["reasons"]) & {"LOCAL_GEOMETRY_CHANGE", "STRUCTURE_CHANGE_OR_UNRESOLVED"})

    def test_untextured_reference_and_unstable_samples_refused(self):
        with self.assertRaisesRegex(ValueError, "landmark"):
            geometry.build_model(np.full((4, 80, 100, 4), 90, np.uint8), self.box)
        samples = [np.roll(self.frame, shift, axis=1) for shift in [0, 3, 6, 9]]
        with self.assertRaisesRegex(ValueError, "landmark"):
            geometry.build_model(np.stack(samples), self.box)

    def test_periodic_pattern_is_ambiguous(self):
        frame = self.frame.copy()
        frame[18:62, 20:80, :3] = np.tile([40, 100, 200, 100], (44, 15))[..., None]
        try:
            model = geometry.build_model(np.stack([frame] * 4), self.box)
        except ValueError:
            return
        self.assertNotEqual(geometry.measure_frame(frame, model)["state"], "STATIC_GEOMETRY_OBSERVED")

    def test_search_boundary_and_wrong_extent_refused(self):
        frame = np.roll(self.frame, 4, axis=1)
        self.assertIn("SEARCH_BOUNDARY_OR_AMBIGUITY", self.measure(frame)["reasons"])
        with self.assertRaisesRegex(ValueError, "extent"):
            self.measure(self.frame[:70])

    def test_invalid_box_frame_type_and_sample_budget_refused(self):
        with self.assertRaisesRegex(ValueError, "box extent"):
            geometry.build_model(np.stack([self.frame] * 4), {**self.box, "x": -1})
        with self.assertRaisesRegex(ValueError, "extent/count"):
            geometry.build_model(np.stack([self.frame] * 97), self.box)
        with self.assertRaisesRegex(ValueError, "extent/type"):
            self.measure(self.frame.astype(np.float64))
        with self.assertRaisesRegex(ValueError, "working-set budget"):
            geometry.build_model(np.broadcast_to(np.zeros((1, 512, 512, 4), np.uint8), (96, 512, 512, 4)), self.box)

    def test_one_frame_and_tail_change_not_smoothed(self):
        sequence = [self.frame.copy() for _ in range(7)]
        sequence[3] = np.roll(self.frame, 1, axis=1)
        sequence[6][18:62, 20:80, :3] = 90
        states = [self.measure(frame)["state"] for frame in sequence]
        self.assertEqual([i for i, state in enumerate(states) if state != "STATIC_GEOMETRY_OBSERVED"], [3, 6])


if __name__ == "__main__":
    unittest.main()
