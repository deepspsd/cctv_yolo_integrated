import logging
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np

from app.config import settings

logger = logging.getLogger("reid_pipeline")

class PersonReIdModel:
    """
    Body Person Re-Identification Model.
    Employs Deep Feature Backbone (MobileNetV3) with orthogonal projection + multi-zone
    color appearance descriptor to produce discriminative 128-dimensional L2-normalized embeddings.
    Includes robust CPU/OpenCV fallback for standalone environments.
    """
    def __init__(self, embedding_dim: int = 128):
        self.embedding_dim = embedding_dim
        self.target_size = (128, 256)  # (w, h)
        self.deep_model = None
        self.device = "cpu"
        self.transform = None
        self.proj_tensor = None

        # Deterministic projection matrix (576 -> 128)
        rng = np.random.RandomState(42)
        proj_576 = rng.randn(576, self.embedding_dim).astype(np.float32)
        proj_576, _ = np.linalg.qr(proj_576)
        self.proj_np = proj_576

        self._init_deep_model()

    def _init_deep_model(self):
        try:
            import torch
            import torchvision.models as models
            import torchvision.transforms as T

            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            m = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
            m.classifier = torch.nn.Identity()
            m = m.to(self.device).eval()
            self.deep_model = m

            self.transform = T.Compose([
                T.ToTensor(),
                T.Resize((256, 128), antialias=True),
                T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            ])
            self.proj_tensor = torch.tensor(self.proj_np, device=self.device)
            logger.info(f"PersonReIdModel initialized with MobileNetV3 backbone on {self.device}")
        except Exception as err:
            logger.warning(f"Could not load deep Re-ID model: {err}. Using color-spatial descriptor fallback.")
            self.deep_model = None

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

        # Check minimum reasonable person dimensions
        crop_w = x2 - x1
        crop_h = y2 - y1
        if crop_w < 16 or crop_h < 32:
            return None

        # Re-ID crops must have plausible person aspect ratio (h > w)
        aspect = float(crop_w) / float(crop_h)
        if aspect > 1.3:  # Too horizontal / not a standing or walking human
            return None

        return frame_bgr[y1:y2, x1:x2]

    def _compute_color_descriptor(self, body_bgr: np.ndarray) -> np.ndarray:
        """
        Multi-zone normalized color-spatial descriptor.
        Evaluates Upper Torso, Lower Torso, and Legs independently.
        """
        resized = cv2.resize(body_bgr, self.target_size, interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        h, w = self.target_size[1], self.target_size[0]

        zones = [
            hsv[int(h * 0.10):int(h * 0.45), :],  # Upper torso / shirt
            hsv[int(h * 0.45):int(h * 0.70), :],  # Lower torso / waist
            hsv[int(h * 0.70):int(h * 0.95), :]   # Legs / trousers
        ]

        feats = []
        for z in zones:
            if z.size == 0:
                feats.extend([0.0] * 32)
                continue
            # 16 hue bins, 8 sat bins, 8 val bins
            h_hist = cv2.calcHist([z], [0], None, [16], [0, 180]).flatten()
            s_hist = cv2.calcHist([z], [1], None, [8], [0, 256]).flatten()
            v_hist = cv2.calcHist([z], [2], None, [8], [0, 256]).flatten()

            # L1 normalize so individual pixel counts do not dominate
            h_hist = h_hist / (np.sum(h_hist) + 1e-6)
            s_hist = s_hist / (np.sum(s_hist) + 1e-6)
            v_hist = v_hist / (np.sum(v_hist) + 1e-6)
            feats.extend(np.concatenate([h_hist, s_hist, v_hist]))

        arr = np.array(feats, dtype=np.float32)
        # Pad or trim to 128 dimensions
        if arr.shape[0] < self.embedding_dim:
            arr = np.pad(arr, (0, self.embedding_dim - arr.shape[0]))
        else:
            arr = arr[:self.embedding_dim]

        norm = np.linalg.norm(arr)
        if norm > 1e-6:
            arr /= norm
        return arr.astype(np.float32)

    def compute_embedding(self, body_bgr: np.ndarray) -> np.ndarray:
        """
        Generates 128-dim L2-normalized body Re-ID embedding.
        Uses MobileNetV3 deep features projected to 128-dim when available.
        """
        if body_bgr is None or body_bgr.size == 0:
            return np.zeros(self.embedding_dim, dtype=np.float32)

        if self.deep_model is not None:
            try:
                import torch
                rgb = cv2.cvtColor(body_bgr, cv2.COLOR_BGR2RGB)
                tensor = self.transform(rgb).unsqueeze(0).to(self.device)
                with torch.no_grad():
                    feat = self.deep_model(tensor)  # (1, 576)
                    proj = torch.matmul(feat, self.proj_tensor)  # (1, 128)
                    norm_proj = torch.nn.functional.normalize(proj, p=2, dim=1)
                    return norm_proj.cpu().numpy().flatten().astype(np.float32)
            except Exception as e:
                logger.error(f"Error in deep Re-ID embedding: {e}")

        # Fallback to normalized color-spatial descriptor
        return self._compute_color_descriptor(body_bgr)

    @staticmethod
    def compute_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
        if emb1 is None or emb2 is None or len(emb1) == 0 or len(emb2) == 0:
            return 0.0
        dot = float(np.dot(emb1, emb2))
        return max(0.0, min(1.0, dot))

    def match_against_templates(
        self,
        query_embedding: np.ndarray,
        body_templates: Dict[str, List[Dict[str, Any]]],
        min_threshold: Optional[float] = None
    ) -> Tuple[Optional[str], float, Optional[Dict[str, Any]]]:
        """
        Matches query body Re-ID vector against stored employee body templates.
        Returns (best_employee_id, best_score, best_template).
        If best_score < threshold, returns (None, score, None) to avoid false matches.
        """
        if query_embedding is None or not body_templates:
            return None, 0.0, None

        threshold = min_threshold if min_threshold is not None else settings.IDENTITY_REID_THRESHOLD

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

        # Strictly enforce threshold gate
        if best_score < threshold:
            return None, round(best_score, 3), None

        return best_emp_id, round(best_score, 3), best_tpl

reid_pipeline = PersonReIdModel()
