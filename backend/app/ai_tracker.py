import math
import logging
from typing import Dict, List, Tuple, Optional, Any

logger = logging.getLogger("ai_tracker")

def compute_iou(boxA: List[float], boxB: List[float]) -> float:
    """
    Compute Intersection over Union between two bounding boxes.
    Format: [x1, y1, x2, y2]
    """
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interW = max(0.0, xB - xA)
    interH = max(0.0, yB - yA)
    interArea = interW * interH

    boxAArea = max(0.0, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    boxBArea = max(0.0, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

    denom = boxAArea + boxBArea - interArea
    if denom <= 0.0:
        return 0.0
    return interArea / denom

def box_center(box: List[float]) -> Tuple[float, float]:
    return ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)

def is_point_inside(point: Tuple[float, float], box: List[float], margin: float = 0.05) -> bool:
    px, py = point
    bw = box[2] - box[0]
    bh = box[3] - box[1]
    return (
        (box[0] - margin * bw) <= px <= (box[2] + margin * bw) and
        (box[1] - margin * bh) <= py <= (box[3] + margin * bh)
    )

class PersonTrack:
    def __init__(self, track_id: int, camera_id: str, box: List[float], confidence: float):
        self.track_id = track_id
        self.camera_id = camera_id
        self.box = box  # [x1, y1, x2, y2]
        self.confidence = confidence
        self.missed_frames = 0
        self.hits = 1
        self.employee_id: Optional[str] = None
        self.employee_name: Optional[str] = None
        self.identity_confidence: float = 0.0
        self.identity_state: str = "UNKNOWN"
        self.associated_ppe: Dict[str, Any] = {}

    def update(self, box: List[float], confidence: float):
        self.box = box
        self.confidence = confidence
        self.missed_frames = 0
        self.hits += 1


class CameraPersonTracker:
    """
    Per-camera independent IoU & Centroid tracker.
    Track IDs scoped to (camera_id, track_id).
    """
    def __init__(self, camera_id: str, max_age: int = 15, iou_threshold: float = 0.3):
        self.camera_id = camera_id
        self.max_age = max_age
        self.iou_threshold = iou_threshold
        self.tracks: Dict[int, PersonTrack] = {}
        self._next_id = 1

    def update(self, person_detections: List[Dict[str, Any]]) -> List[PersonTrack]:
        """
        person_detections: list of dicts with 'box': [x1, y1, x2, y2] and 'confidence'
        """
        # Match current detections with active tracks
        unmatched_dets = list(range(len(person_detections)))
        matched_tracks = set()

        if self.tracks and person_detections:
            # Greedy IoU matching
            cost_matrix = []
            track_ids = list(self.tracks.keys())
            for tid in track_ids:
                trk = self.tracks[tid]
                row = [compute_iou(trk.box, det["box"]) for det in person_detections]
                cost_matrix.append(row)

            # Assign best matches
            for t_idx, tid in enumerate(track_ids):
                row = cost_matrix[t_idx]
                if not row:
                    continue
                best_d_idx = max(range(len(row)), key=lambda i: row[i])
                best_iou = row[best_d_idx]

                if best_iou >= self.iou_threshold and best_d_idx in unmatched_dets:
                    self.tracks[tid].update(
                        person_detections[best_d_idx]["box"],
                        person_detections[best_d_idx]["confidence"]
                    )
                    matched_tracks.add(tid)
                    unmatched_dets.remove(best_d_idx)

        # Mark unmatched active tracks as missed
        for tid, trk in list(self.tracks.items()):
            if tid not in matched_tracks:
                trk.missed_frames += 1
                if trk.missed_frames > self.max_age:
                    del self.tracks[tid]

        # Initialize new tracks for unmatched detections
        for d_idx in unmatched_dets:
            det = person_detections[d_idx]
            new_trk = PersonTrack(
                track_id=self._next_id,
                camera_id=self.camera_id,
                box=det["box"],
                confidence=det["confidence"]
            )
            self.tracks[self._next_id] = new_trk
            self._next_id += 1

        return list(self.tracks.values())


class ScopedMultiCameraTracker:
    """
    Maintains independent trackers per camera.
    """
    def __init__(self):
        self._camera_trackers: Dict[str, CameraPersonTracker] = {}

    def get_tracker(self, camera_id: str) -> CameraPersonTracker:
        if camera_id not in self._camera_trackers:
            self._camera_trackers[camera_id] = CameraPersonTracker(camera_id=camera_id)
        return self._camera_trackers[camera_id]

    def remove_camera(self, camera_id: str):
        self._camera_trackers.pop(camera_id, None)

    def associate_ppe_to_persons(
        self,
        camera_id: str,
        active_tracks: List[PersonTrack],
        ppe_items: List[Dict[str, Any]],
        machinery_items: List[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Spatial logic association:
        Associates PPE violations/detections and machinery hazards to nearby person tracks.
        """
        results = []
        if not active_tracks:
            return results

        for ppe in ppe_items:
            ppe_box = ppe["box"]
            ppe_center = box_center(ppe_box)
            ppe_type = ppe["type"]
            best_person = None
            best_score = 0.0

            for trk in active_tracks:
                p_box = trk.box
                # Check spatial evidence
                inside = is_point_inside(ppe_center, p_box, margin=0.1)
                iou = compute_iou(p_box, ppe_box)

                # Prioritize hardhat / mask in upper body / head region
                score = 0.0
                if inside:
                    score = 1.0 + iou
                elif iou > 0.05:
                    score = iou

                if score > best_score and score >= 0.1:
                    best_score = score
                    best_person = trk

            if best_person:
                results.append({
                    "track_id": best_person.track_id,
                    "camera_id": camera_id,
                    "anomaly_type": ppe_type,
                    "model_class_id": ppe.get("class_id"),
                    "model_class_name": ppe.get("class_name"),
                    "confidence": ppe["confidence"],
                    "ppe_box": ppe_box,
                    "person_box": best_person.box,
                    "employee_id": best_person.employee_id,
                    "employee_name": best_person.employee_name,
                    "association_score": round(best_score, 2)
                })

        # Check hazardous machinery / vehicle proximity
        if machinery_items:
            for mach in machinery_items:
                m_box = mach["box"]
                for trk in active_tracks:
                    p_box = trk.box
                    # Measure distance between centers relative to frame
                    p_c = box_center(p_box)
                    m_c = box_center(m_box)
                    dist = math.hypot(p_c[0] - m_c[0], p_c[1] - m_c[1])
                    iou = compute_iou(p_box, m_box)

                    # Close proximity threshold (overlap or close distance)
                    if iou > 0.01 or dist < 0.25:
                        results.append({
                            "track_id": trk.track_id,
                            "camera_id": camera_id,
                            "anomaly_type": "MACHINERY_HAZARD",
                            "model_class_id": mach.get("class_id"),
                            "model_class_name": mach.get("class_name"),
                            "confidence": round(mach["confidence"] * trk.confidence, 2),
                            "ppe_box": m_box,
                            "person_box": trk.box,
                            "employee_id": trk.employee_id,
                            "employee_name": trk.employee_name,
                            "association_score": round(1.0 - min(1.0, dist), 2)
                        })

        return results

multi_camera_tracker = ScopedMultiCameraTracker()
