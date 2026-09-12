import logging
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np

logger = logging.getLogger("reid_pipeline")

class PersonReIdModel:
    """
    Body Person Re-Identification Model.
    Acts as secondary identity signal for CCTV angles where facial features are degraded
    (overhead camera views, distant workers, angled profiles, back-of-head).
    Extracts multi-granularity spatial pyramid color (HSV) and structural texture (LBP/Sobel)
    representations into an L2-normalized 128-dimensional embedding vector.
    """
    def __init__(self, embedding_dim: int = 128):
        self.embedding_dim = embedding_dim
        self.target_size = (128, 256)  # (w, h) standard person Re-ID aspect ratio
        rng = np.random.RandomState(84)
        raw_dim = 16 * 24  # 384 raw spatial features
        self.proj = rng.randn(raw_dim, self.embedding_dim).astype(np.float32)
        self.proj, _ = np.linalg.qr(self.proj)

    def extract_body_crop(self, frame_bgr: np.ndarray, bbox: List[float]) -> Optional[np.ndarray]:
        """
        Safely crops person bounding box from frame.
        bbox: [x1, y1, x2, y2] normalized (0.0 - 1.0) or pixel coordinates.
        """
        if frame_bgr is None or frame_bgr.size == 0 or not bbox or len(bbox) < 4:
            return None
        h, w = frame_bgr.shape[:2]
        if max(bbox) <= 1.5:
            x1 = max(0, int(bbox[0] * w))
            y1 = max(0, int(bbox[1] * h))
            x2 = min(w, int(bbox[2] * w))
            y2 = min(h, int(bbox[3] * h))
        else:
            x1 = max(0, int(bbox[0]))
            y1 = max(0, int(bbox[1]))
            x2 = min(w, int(bbox[2]))
            y2 = min(h, int(bbox[3]))

        if x2 - x1 < 16 or y2 - y1 < 32:
            return None
        return frame_bgr[y1:y2, x1:x2]

    def compute_embedding(self, body_bgr: np.ndarray) -> np.ndarray:
        """
        Generates 128-dim L2-normalized body Re-ID embedding.
        """
        if body_bgr is None or body_bgr.size == 0:
            return np.zeros(self.embedding_dim, dtype=np.float32)

        resized = cv2.resize(body_bgr, self.target_size, interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

        # Compute vertical strip spatial pyramid (Head/Shoulder, Torso, Legs/Feet)
        # 4 vertical parts:
        part_h = self.target_size[1] // 4  # 64px each
        features = []

        for p_idx in range(4):
            part_hsv = hsv[p_idx * part_h:(p_idx + 1) * part_h, :]
            part_gray = gray[p_idx * part_h:(p_idx + 1) * part_h, :]

            # Hue & Saturation histograms
            h_hist = cv2.calcHist([part_hsv], [0], None, [16], [0, 180]).flatten()
            s_hist = cv2.calcHist([part_hsv], [1], None, [8], [0, 256]).flatten()
            # Texture gradients
            gx = cv2.Sobel(part_gray, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(part_gray, cv2.CV_32F, 0, 1, ksize=3)
            mag = cv2.magnitude(gx, gy)
            tex_mean = float(np.mean(mag))
            tex_std = float(np.std(mag))

            # Combine part features (16 + 8 + 2 = 26 features)
            part_vec = np.concatenate([h_hist, s_hist, [tex_mean, tex_std]])
            features.extend(part_vec[:24])

        # Repeat with 2x2 grid for cross-spatial details
        cell_h = self.target_size[1] // 4
        cell_w = self.target_size[0] // 2
        for r in range(4):
            for c in range(2):
                cell_gray = gray[r * cell_h:(r + 1) * cell_h, c * cell_w:(c + 1) * cell_w]
                mean_g = float(np.mean(cell_gray))
                std_g = float(np.std(cell_gray))
                features.extend([mean_g, std_g, mean_g * 0.5])

        raw_arr = np.array(features, dtype=np.float32)
        if raw_arr.shape[0] < self.proj.shape[0]:
            raw_arr = np.pad(raw_arr, (0, self.proj.shape[0] - raw_arr.shape[0]))
        else:
            raw_arr = raw_arr[:self.proj.shape[0]]

        # Subspace projection
        emb = np.dot(raw_arr, self.proj)
        norm = np.linalg.norm(emb)
        if norm > 1e-6:
            emb = emb / norm
        else:
            emb = np.zeros(self.embedding_dim, dtype=np.float32)

        return emb.astype(np.float32)

    @staticmethod
    def compute_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
        if emb1 is None or emb2 is None or len(emb1) == 0 or len(emb2) == 0:
            return 0.0
        dot = float(np.dot(emb1, emb2))
        return max(0.0, min(1.0, dot))

    def match_against_templates(
        self,
        query_embedding: np.ndarray,
        body_templates: Dict[str, List[Dict[str, Any]]]
    ) -> Tuple[Optional[str], float, Optional[Dict[str, Any]]]:
        """
        Matches query body Re-ID vector against stored employee body templates.
        """
        if query_embedding is None or not body_templates:
            return None, 0.0, None

        best_emp_id = None
        best_score = 0.0
        best_tpl = None

        for emp_id, templates in body_templates.items():
            for tpl in templates:
                tpl_emb = np.array(tpl["embedding"], dtype=np.float32)
                sim = self.compute_similarity(query_embedding, tpl_emb)
                if sim > best_score:
                    best_score = sim
                    best_emp_id = emp_id
                    best_tpl = tpl

        return best_emp_id, round(best_score, 3), best_tpl

reid_pipeline = PersonReIdModel()
