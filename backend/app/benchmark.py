import os
import sys
import time
import logging
from pathlib import Path
from typing import Dict, List, Any
from collections import deque

import cv2
import numpy as np
import psutil
from ultralytics import YOLO

# Add backend directory to path if needed
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.config import settings
from app.ai_rules import rule_registry

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("benchmark")

def run_camera_benchmark(camera_counts: List[int] = [1, 5, 10, 20], test_duration_sec: float = 6.0) -> List[Dict[str, Any]]:
    """
    Hardware capacity benchmark testing 1, 5, 10, and 20 camera streams.
    Measures sustainable FPS, latency percentiles (p50, p95), CPU, RAM, and GPU memory.
    """
    print("=" * 80)
    print("CCTV PRIYA TEXTILES - AI HARDWARE CAPACITY BENCHMARK")
    print(f"Target: Continuous Inference across 1, 5, 10, 20 Cameras")
    print(f"Test Duration per Stage: {test_duration_sec:.1f}s | Batch Size: {settings.AI_BATCH_SIZE}")
    print("=" * 80)

    # 1. Device and Model Initialization
    try:
        import torch
        has_cuda = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if has_cuda else "N/A (CPU Mode)"
    except Exception:
        has_cuda = False
        gpu_name = "N/A"

    device = "cuda" if has_cuda else "cpu"
    use_fp16 = has_cuda and settings.AI_USE_FP16

    print(f"Hardware Detected: CPU={psutil.cpu_count(logical=True)} cores | RAM={psutil.virtual_memory().total / (1024**3):.1f} GB | GPU={gpu_name}")
    print(f"PyTorch Device: {device.upper()} (FP16: {use_fp16})")

    # Locate model
    model_path = Path("models/ppe.pt")
    if not model_path.exists():
        model_path = backend_dir / "models/ppe.pt"
    if not model_path.exists():
        model_path = backend_dir.parent / "models/ppe.pt"

    print(f"Loading Model: {model_path} ...")
    model = YOLO(str(model_path))

    # Dynamic Class Discovery
    disc_summary = rule_registry.discover_classes(model)
    print(f"Discovered Model Classes ({len(model.names)}): {list(model.names.values())}")
    print(f"Available Rules: {disc_summary['available_rules']}")
    print(f"Unavailable Rules: {disc_summary['unavailable_rules']}")
    print("-" * 80)

    dummy = [np.zeros((360, 640, 3), dtype=np.uint8) for _ in range(settings.AI_BATCH_SIZE)]
    model(dummy, verbose=False, device=device)

    results_table = []

    for num_cams in camera_counts:
        print(f"\n>>> Running Benchmark for {num_cams} Camera Streams (Target: {settings.AI_DEFAULT_FPS} FPS/cam) ...")

        # Initialize simulated camera frame queues
        target_fps = settings.AI_DEFAULT_FPS
        interval = 1.0 / target_fps
        last_inferred = [0.0] * num_cams
        frames_inferred = [0] * num_cams
        latencies_ms = []

        # Synthetic realistic 640x360 frames
        test_frames = []
        for i in range(num_cams):
            frame = np.zeros((360, 640, 3), dtype=np.uint8)
            frame[:] = (35 + i * 2, 35 + i * 2, 35 + i * 2)
            cv2.rectangle(frame, (100 + i * 10, 80), (300, 300), (80, 80, 80), -1)
            cv2.putText(frame, f"CAM-{i+1:02d} SIM", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            test_frames.append(frame)

        start_time = time.monotonic()
        next_push_time = start_time
        total_batches = 0
        total_frames_inferred = 0

        cpu_readings = []
        ram_readings = []

        while time.monotonic() - start_time < test_duration_sec:
            now = time.monotonic()
            cpu_readings.append(psutil.cpu_percent(interval=None))
            ram_readings.append(psutil.virtual_memory().used / (1024 * 1024))

            # Find overdue cameras
            overdue_indices = []
            for i in range(num_cams):
                if now - last_inferred[i] >= interval - 0.01:
                    overdue_indices.append(i)

            if not overdue_indices:
                time.sleep(0.005)
                continue

            # Take up to batch size
            batch_idxs = overdue_indices[:settings.AI_BATCH_SIZE]
            batch = [test_frames[idx] for idx in batch_idxs]

            t0 = time.perf_counter()
            _ = model(batch, verbose=False, device=device)
            t1 = time.perf_counter()

            total_lat = (t1 - t0) * 1000.0
            per_frame_lat = total_lat / len(batch)
            latencies_ms.extend([per_frame_lat] * len(batch))

            for idx in batch_idxs:
                last_inferred[idx] = time.monotonic()
                frames_inferred[idx] += 1

            total_batches += 1
            total_frames_inferred += len(batch)

        elapsed = time.monotonic() - start_time
        actual_total_fps = round(total_frames_inferred / elapsed, 1)
        actual_fps_per_cam = round(actual_total_fps / num_cams, 1)
        avg_lat = round(np.mean(latencies_ms), 1) if latencies_ms else 0.0
        p50_lat = round(np.percentile(latencies_ms, 50), 1) if latencies_ms else 0.0
        p95_lat = round(np.percentile(latencies_ms, 95), 1) if latencies_ms else 0.0
        avg_cpu = round(np.mean(cpu_readings), 1) if cpu_readings else 0.0
        avg_ram = round(np.mean(ram_readings), 1) if ram_readings else 0.0

        gpu_mem_mb = 0.0
        if has_cuda:
            try:
                gpu_mem_mb = round(torch.cuda.memory_allocated() / (1024 * 1024), 1)
            except Exception:
                pass

        stage_result = {
            "cameras": num_cams,
            "target_fps_per_cam": target_fps,
            "actual_fps_per_cam": actual_fps_per_cam,
            "total_actual_fps": actual_total_fps,
            "avg_latency_ms": avg_lat,
            "p50_latency_ms": p50_lat,
            "p95_latency_ms": p95_lat,
            "cpu_percent": avg_cpu,
            "ram_used_mb": avg_ram,
            "gpu_mem_mb": gpu_mem_mb
        }
        results_table.append(stage_result)

        print(f"Results for {num_cams} cameras:")
        print(f"  * Total Throughput: {actual_total_fps} FPS (avg {actual_fps_per_cam} FPS/cam vs {target_fps} target)")
        print(f"  * Latency: Avg={avg_lat}ms | p50={p50_lat}ms | p95={p95_lat}ms")
        print(f"  * Resource Usage: CPU={avg_cpu}% | RAM={avg_ram:.0f}MB | GPU VRAM={gpu_mem_mb}MB")

    # Print final summary table
    print("\n" + "=" * 80)
    print("FINAL BENCHMARK CAPACITY SUMMARY")
    print("=" * 80)
    print(f"{'Cameras':<9}{'Target FPS':<12}{'Actual FPS':<12}{'Total FPS':<12}{'p50 Latency':<14}{'p95 Latency':<14}{'CPU %':<8}{'RAM (MB)':<10}{'VRAM (MB)'}")
    print("-" * 80)
    for r in results_table:
        print(f"{r['cameras']:<9}{r['target_fps_per_cam']:<12}{r['actual_fps_per_cam']:<12}{r['total_actual_fps']:<12}{str(r['p50_latency_ms'])+'ms':<14}{str(r['p95_latency_ms'])+'ms':<14}{str(r['cpu_percent'])+'%':<8}{r['ram_used_mb']:<10}{r['gpu_mem_mb']}")
    print("=" * 80)
    return results_table

if __name__ == "__main__":
    run_camera_benchmark()
