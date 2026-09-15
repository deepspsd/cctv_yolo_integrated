import re
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from ultralytics import YOLO

logger = logging.getLogger("ai_rules")

class AnomalyRuleRegistry:
    """
    Dynamic class discovery and anomaly mapping engine.
    Inspects model.names at startup without hardcoding class IDs.
    Normalizes class names and exposes class availability.
    """
    def __init__(self, model_path: str = "models/ppe.pt"):
        self.model_path = model_path
        self.raw_classes: Dict[int, str] = {}
        self.normalized_classes: Dict[int, str] = {}
        self.rule_mappings: Dict[str, Dict[str, Any]] = {}
        self._initialized = False

    def _normalize_name(self, name: str) -> str:
        return re.sub(r"[^a-z0-9]", "", name.lower().strip())

    def discover_classes(self, model: YOLO, phone_model: Optional[YOLO] = None) -> Dict[str, Any]:
        """
        Inspect model.names and dynamically build semantic mappings.
        Optionally inspects dedicated phone_model (e.g. models/phone.pt).
        """
        self.raw_classes = {int(k): str(v) for k, v in model.names.items()}
        self.normalized_classes = {
            k: self._normalize_name(v) for k, v in self.raw_classes.items()
        }

        phone_classes = {}
        if phone_model is not None and hasattr(phone_model, "names") and phone_model.names:
            phone_classes = {int(k): str(v) for k, v in phone_model.names.items()}

        # Candidate target anomaly categories
        target_rules = {
            "NO_HARDHAT": {
                "patterns": ["nohardhat", "missinghardhat", "nohelmet"],
                "category": "VIOLATION",
                "label": "Missing Safety Helmet / Hardhat",
                "severity": "HIGH",
            },
            "NO_MASK": {
                "patterns": ["nomask", "missingmask", "nofacemask"],
                "category": "VIOLATION",
                "label": "Missing Protective Face Mask",
                "severity": "MEDIUM",
            },
            "NO_SAFETY_VEST": {
                "patterns": ["nosafetyvest", "novest", "missingsafetyvest"],
                "category": "VIOLATION",
                "label": "Missing High-Visibility Safety Vest",
                "severity": "HIGH",
            },
            "PERSON_DETECTED": {
                "patterns": ["person", "human"],
                "category": "DETECTION",
                "label": "Person Detected in Monitored Zone",
                "severity": "NORMAL",
            },
            "MACHINERY_HAZARD": {
                "patterns": ["machinery", "vehicle"],
                "category": "VIOLATION",
                "label": "Worker in Close Proximity to Heavy Machinery",
                "severity": "HIGH",
            },
            "PHONE_VIOLATION": {
                "patterns": ["phonecall", "phone_call", "cellphone", "phone", "mobilephone", "telephone"],
                "category": "VIOLATION",
                "label": "Cell Phone Usage in Restricted Area",
                "severity": "HIGH",
            }
        }

        self.rule_mappings = {}
        for rule_id, rule_info in target_rules.items():
            matched_cls_id = None
            matched_cls_name = None
            for pattern in rule_info["patterns"]:
                for cls_id, norm_name in self.normalized_classes.items():
                    if pattern == norm_name or pattern in norm_name:
                        matched_cls_id = cls_id
                        matched_cls_name = self.raw_classes[cls_id]
                        break
                if matched_cls_id is not None:
                    break

            if matched_cls_id is not None:
                self.rule_mappings[rule_id] = {
                    "rule_id": rule_id,
                    "available": True,
                    "model_class_id": matched_cls_id,
                    "model_class_name": matched_cls_name,
                    "category": rule_info["category"],
                    "label": rule_info["label"],
                    "severity": rule_info["severity"],
                    "reason": "Supported by active model"
                }
            elif rule_id == "PHONE_VIOLATION" and phone_classes:
                # Discover from dedicated phone model
                p_match_id = None
                p_match_name = None
                for pattern in rule_info["patterns"]:
                    for p_id, p_raw in phone_classes.items():
                        norm_p = self._normalize_name(p_raw)
                        if pattern == norm_p or pattern in norm_p:
                            p_match_id = p_id
                            p_match_name = p_raw
                            break
                    if p_match_id is not None:
                        break
                if p_match_id is not None:
                    self.rule_mappings[rule_id] = {
                        "rule_id": rule_id,
                        "available": True,
                        "model_class_id": p_match_id,
                        "model_class_name": p_match_name,
                        "category": rule_info["category"],
                        "label": rule_info["label"],
                        "severity": rule_info["severity"],
                        "reason": "Supported by dedicated phone.pt model"
                    }
                else:
                    self.rule_mappings[rule_id] = {
                        "rule_id": rule_id,
                        "available": False,
                        "model_class_id": None,
                        "model_class_name": None,
                        "category": rule_info["category"],
                        "label": rule_info["label"],
                        "severity": rule_info["severity"],
                        "reason": f"Class '{rule_id}' not found in phone model"
                    }
            else:
                self.rule_mappings[rule_id] = {
                    "rule_id": rule_id,
                    "available": False,
                    "model_class_id": None,
                    "model_class_name": None,
                    "category": rule_info["category"],
                    "label": rule_info["label"],
                    "severity": rule_info["severity"],
                    "reason": f"Class '{rule_id}' not found in active model {Path(self.model_path).name}"
                }

        self._initialized = True
        logger.info(
            f"Model class discovery complete: {len(self.raw_classes)} classes found. "
            f"Available anomaly rules: {[k for k, v in self.rule_mappings.items() if v['available']]}"
        )
        return self.get_registry_summary()

    def get_registry_summary(self) -> Dict[str, Any]:
        return {
            "model_path": self.model_path,
            "raw_classes": self.raw_classes,
            "total_classes": len(self.raw_classes),
            "rules": self.rule_mappings,
            "available_rules": [k for k, v in self.rule_mappings.items() if v.get("available")],
            "unavailable_rules": [k for k, v in self.rule_mappings.items() if not v.get("available")]
        }

    def get_rule_for_class_id(self, cls_id: int) -> Optional[Dict[str, Any]]:
        for rule_id, rule_info in self.rule_mappings.items():
            if rule_info.get("available") and rule_info.get("model_class_id") == cls_id:
                return rule_info
        return None

    def get_rule_for_class_name(self, cls_name: str) -> Optional[Dict[str, Any]]:
        norm = self._normalize_name(cls_name)
        if "phone" in norm:
            rule = self.rule_mappings.get("PHONE_VIOLATION")
            if rule and rule.get("available"):
                return rule
        for rule_id, rule_info in self.rule_mappings.items():
            if rule_info.get("available"):
                m_name = self._normalize_name(rule_info.get("model_class_name") or "")
                if norm == m_name:
                    return rule_info
        return None

rule_registry = AnomalyRuleRegistry()
