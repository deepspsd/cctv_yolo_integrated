import io
import csv
import json
import uuid
import logging
import time
from datetime import datetime, timezone, date, timedelta
from typing import Dict, List, Optional, Any, Tuple

from sqlalchemy import select, func, and_, desc, asc
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Employee, Attendance, AttendanceObservation, FaceTemplate, BodyTemplate, Camera
from app.websocket_manager import ws_manager
from app.identity_fusion import identity_fusion

logger = logging.getLogger("attendance_service")

class AttendanceService:
    """
    Automatic Employee Attendance Service for multi-camera CCTV setup.
    - Manages first-seen clock-in and last-seen updates across all cameras.
    - Prevents duplicate daily attendance records for the same employee.
    - Finalizes clock-out upon absence threshold expiry or end-of-day.
    - Exports formatted attendance sheets to CSV and XLSX.
    """
    def __init__(self):
        self.absence_timeout_minutes = settings.ATTENDANCE_ABSENCE_MINUTES
        self._last_broadcast_by_emp: Dict[str, float] = {}

    async def reload_templates_cache(self, db_session: Optional[Any] = None):
        """
        Loads all employee records, face templates, and body templates into in-memory fusion cache.
        """
        try:
            async def _load(db):
                emp_res = await db.execute(select(Employee).where(Employee.active == True))
                employees = emp_res.scalars().all()
                emp_map = {e.id: {"id": e.id, "code": e.employee_code, "name": e.name, "dept": e.department} for e in employees}

                face_res = await db.execute(select(FaceTemplate))
                f_templates = face_res.scalars().all()
                face_by_emp: Dict[str, List[Dict[str, Any]]] = {}
                for ft in f_templates:
                    if ft.employee_id not in face_by_emp:
                        face_by_emp[ft.employee_id] = []
                    try:
                        emb = json.loads(ft.embedding) if isinstance(ft.embedding, str) else ft.embedding
                        face_by_emp[ft.employee_id].append({
                            "id": ft.id,
                            "embedding": emb,
                            "pose": ft.pose,
                            "quality_score": ft.quality_score,
                            "source": ft.source
                        })
                    except Exception as ex:
                        logger.error(f"Error parsing face template {ft.id}: {ex}")

                body_res = await db.execute(select(BodyTemplate))
                b_templates = body_res.scalars().all()
                body_by_emp: Dict[str, List[Dict[str, Any]]] = {}
                for bt in b_templates:
                    if bt.employee_id not in body_by_emp:
                        body_by_emp[bt.employee_id] = []
                    try:
                        emb = json.loads(bt.embedding) if isinstance(bt.embedding, str) else bt.embedding
                        body_by_emp[bt.employee_id].append({
                            "id": bt.id,
                            "embedding": emb,
                            "model_name": bt.model_name,
                            "quality_score": bt.quality_score,
                            "source": bt.source
                        })
                    except Exception as ex:
                        logger.error(f"Error parsing body template {bt.id}: {ex}")

                identity_fusion.set_employee_templates(face_by_emp, body_by_emp, emp_map)
                logger.info(f"Loaded {len(employees)} employees, {len(f_templates)} face templates, {len(b_templates)} body templates into fusion cache.")

            if db_session is not None:
                await _load(db_session)
            else:
                async with AsyncSessionLocal() as db:
                    await _load(db)
        except Exception as e:
            logger.error(f"Failed to reload attendance templates cache: {e}", exc_info=True)

    async def record_confirmed_observation(
        self,
        employee_id: str,
        camera_id: str,
        track_id: Optional[int],
        identity_confidence: float,
        face_confidence: Optional[float] = None,
        body_reid_confidence: Optional[float] = None,
        is_face_verified: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Processes a confirmed employee observation:
        - If first confirmed observation today: requires is_face_verified=True to create clock_in attendance record.
        - If subsequent confirmed observation today: updates last_seen_at and last_seen_camera_id.
        - Persists observation event to attendance_observations.
        """
        now = datetime.now(timezone.utc)
        today_str = now.strftime("%Y-%m-%d")

        try:
            async with AsyncSessionLocal() as db:
                # 1. Query today's attendance record for this employee
                stmt = select(Attendance).where(
                    and_(Attendance.employee_id == employee_id, Attendance.date == today_str)
                )
                res = await db.execute(stmt)
                att = res.scalar_one_or_none()

                # Guard: Initial Clock-In requires biometric face verification
                if att is None and not is_face_verified:
                    logger.info(
                        f"Skipping clock-in for employee {employee_id} via {camera_id}: "
                        f"Biometric face verification required for initial clock-in."
                    )
                    return None

                # 2. Log observation record
                obs = AttendanceObservation(
                    id=f"obs_{uuid.uuid4().hex[:12]}",
                    employee_id=employee_id,
                    camera_id=camera_id,
                    track_id=track_id,
                    timestamp=now,
                    identity_confidence=round(identity_confidence, 3),
                    face_confidence=round(face_confidence, 3) if face_confidence is not None else None,
                    body_reid_confidence=round(body_reid_confidence, 3) if body_reid_confidence is not None else None,
                    source="CCTV"
                )
                db.add(obs)

                is_new_clock_in = False
                if att is None:
                    # First confirmed observation of the day -> Clock-In!
                    att = Attendance(
                        id=f"att_{uuid.uuid4().hex[:12]}",
                        employee_id=employee_id,
                        date=today_str,
                        first_seen_at=now,
                        last_seen_at=now,
                        clock_in_camera_id=camera_id,
                        last_seen_camera_id=camera_id,
                        clock_in_confidence=round(identity_confidence, 3),
                        status="PRESENT",
                        created_at=now,
                        updated_at=now
                    )
                    db.add(att)
                    is_new_clock_in = True
                    logger.info(f"Automatic Clock-In for employee {employee_id} at {now.strftime('%H:%M:%S')} via camera {camera_id}")
                else:
                    # Subsequent observation -> Update last_seen_at
                    att.last_seen_at = now
                    att.last_seen_camera_id = camera_id
                    att.updated_at = now
                    if att.status == "COMPLETED":
                        att.status = "PRESENT"  # Re-opened if employee reappeared

                await db.commit()
                await db.refresh(att)

                # Fetch camera names and employee details for broadcasting
                cam_res = await db.execute(select(Camera.name).where(Camera.id == camera_id))
                cam_name = cam_res.scalar_one_or_none() or camera_id

                emp_res = await db.execute(select(Employee).where(Employee.id == employee_id))
                emp = emp_res.scalar_one_or_none()

                first_seen_iso = att.first_seen_at.isoformat() if att.first_seen_at else None
                last_seen_iso = att.last_seen_at.isoformat() if att.last_seen_at else None
                dur_hrs = "0.0"
                if att.first_seen_at and att.last_seen_at:
                    sec = (att.last_seen_at - att.first_seen_at).total_seconds()
                    dur_hrs = f"{sec / 3600.0:.2f}"

                payload = {
                    "id": att.id,
                    "employeeId": att.employee_id,
                    "employeeCode": emp.employee_code if emp else "",
                    "employeeName": emp.name if emp else "Unknown",
                    "department": emp.department if emp else "General",
                    "designation": emp.role if emp and emp.role else "Staff",
                    "date": att.date,
                    "firstSeenAt": first_seen_iso,
                    "lastSeenAt": last_seen_iso,
                    "clockInTime": first_seen_iso,
                    "lastSeenTime": last_seen_iso,
                    "clockInCameraId": att.clock_in_camera_id,
                    "lastSeenCameraId": att.last_seen_camera_id,
                    "clockInCameraName": cam_name,
                    "lastSeenCameraName": cam_name,
                    "cameraName": cam_name,
                    "confidence": att.clock_in_confidence,
                    "clockInConfidence": att.clock_in_confidence,
                    "status": att.status,
                    "durationHours": dur_hrs,
                    "totalHours": float(dur_hrs),
                    "isClockIn": is_new_clock_in
                }

                # Broadcast live attendance event over WebSockets (throttled to avoid spamming frontend)
                now_mono = time.monotonic()
                last_broadcast = self._last_broadcast_by_emp.get(employee_id, 0.0)
                # Always broadcast initial clock-in immediately; throttle subsequent track updates to once every 30s
                if is_new_clock_in or (now_mono - last_broadcast) >= 30.0:
                    self._last_broadcast_by_emp[employee_id] = now_mono
                    await ws_manager.broadcast("ATTENDANCE_UPDATE", payload)

                return payload

        except Exception as e:
            logger.error(f"Error recording confirmed attendance observation: {e}", exc_info=True)
            return None

    async def finalize_absent_clockouts(self) -> int:
        """
        Background task: marks attendance records as COMPLETED if an employee has not
        been observed for longer than absence_timeout_minutes.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=self.absence_timeout_minutes)
        finalized_count = 0

        try:
            async with AsyncSessionLocal() as db:
                stmt = select(Attendance).where(
                    and_(
                        Attendance.status == "PRESENT",
                        Attendance.last_seen_at < cutoff
                    )
                )
                res = await db.execute(stmt)
                records = res.scalars().all()

                for att in records:
                    att.status = "COMPLETED"
                    att.updated_at = now
                    finalized_count += 1

                if finalized_count > 0:
                    await db.commit()
                    logger.info(f"Finalized clock-outs for {finalized_count} employees absent > {self.absence_timeout_minutes}m")
        except Exception as e:
            logger.error(f"Error finalizing absent clock-outs: {e}")

        return finalized_count

    async def get_attendance_summary(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """
        Calculates daily summary statistics:
        - Total employees
        - Total clocked-in today
        - Currently active (seen in last 30m)
        - Finalized / clocked out
        """
        if not target_date:
            target_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        try:
            async with AsyncSessionLocal() as db:
                total_emps_res = await db.execute(select(func.count(Employee.id)).where(Employee.active == True))
                total_employees = total_emps_res.scalar() or 0

                att_res = await db.execute(select(Attendance).where(Attendance.date == target_date))
                attendances = att_res.scalars().all()

                present_count = len(attendances)
                now = datetime.now(timezone.utc)
                cutoff = now - timedelta(minutes=self.absence_timeout_minutes)

                active_on_site = sum(1 for a in attendances if a.status == "PRESENT" and a.last_seen_at >= cutoff)
                completed_count = sum(1 for a in attendances if a.status == "COMPLETED" or a.last_seen_at < cutoff)

                return {
                    "date": target_date,
                    "totalEmployees": total_employees,
                    "totalRegistered": total_employees,
                    "clockedInToday": present_count,
                    "totalPresent": present_count,
                    "activeOnSite": active_on_site,
                    "currentlyOnSite": active_on_site,
                    "completedShifts": completed_count,
                    "attendanceRate": round((present_count / max(1, total_employees)) * 100, 1),
                    "totalPpeViolationsToday": 0
                }
        except Exception as e:
            logger.error(f"Error getting attendance summary: {e}")
            return {
                "date": target_date,
                "totalEmployees": 0,
                "totalRegistered": 0,
                "clockedInToday": 0,
                "totalPresent": 0,
                "activeOnSite": 0,
                "currentlyOnSite": 0,
                "completedShifts": 0,
                "attendanceRate": 0.0,
                "totalPpeViolationsToday": 0
            }

    async def export_attendance_csv(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        employee_id: Optional[str] = None
    ) -> str:
        """
        Generates RFC 4180 CSV export of attendance records.
        """
        records = await self._fetch_attendance_export_data(date_from, date_to, department, employee_id)
        output = io.StringIO()
        writer = csv.writer(output)

        # Header columns
        writer.writerow([
            "Employee ID",
            "Employee Code",
            "Employee Name",
            "Department",
            "Date",
            "Clock In Time",
            "Last Seen Time",
            "Clock Out Time",
            "First Camera",
            "Last Camera",
            "Total Duration (Hours)",
            "Confidence",
            "Status"
        ])

        for r in records:
            writer.writerow([
                r["employee_id"],
                r["employee_code"],
                r["name"],
                r["department"],
                r["date"],
                r["clock_in"],
                r["last_seen"],
                r["clock_out"],
                r["first_camera"],
                r["last_camera"],
                r["duration_hours"],
                f"{int(r['confidence'] * 100)}%",
                r["status"]
            ])

        return output.getvalue()

    async def export_attendance_xlsx(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        employee_id: Optional[str] = None
    ) -> bytes:
        """
        Generates styled Microsoft Excel (.xlsx) workbook using openpyxl.
        """
        records = await self._fetch_attendance_export_data(date_from, date_to, department, employee_id)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "CCTV Attendance Report"

        # Styles
        header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1A1A1E", end_color="1A1A1E", fill_type="solid")
        title_font = Font(name="Segoe UI", size=14, bold=True, color="000000")
        regular_font = Font(name="Segoe UI", size=10)
        bold_font = Font(name="Segoe UI", size=10, bold=True)
        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")
        thin_border = Border(
            left=Side(style='thin', color='E0E0E0'),
            right=Side(style='thin', color='E0E0E0'),
            top=Side(style='thin', color='E0E0E0'),
            bottom=Side(style='thin', color='E0E0E0')
        )

        # Title Block
        ws.merge_cells("A1:M1")
        ws["A1"] = "CCTV PRIYA TEXTILES - AUTOMATIC ATTENDANCE REPORT"
        ws["A1"].font = title_font
        ws["A1"].alignment = left_align
        ws.row_dimensions[1].height = 25

        ws.merge_cells("A2:M2")
        ws["A2"] = f"Generated at: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} | Multi-Camera AI Tracking"
        ws["A2"].font = Font(name="Segoe UI", size=9, italic=True, color="666666")
        ws.row_dimensions[2].height = 18

        # Header Row
        headers = [
            "Employee ID", "Employee Code", "Employee Name", "Department",
            "Date", "Clock In", "Last Seen", "Clock Out",
            "First Camera", "Last Camera", "Duration (Hrs)", "Confidence", "Status"
        ]

        ws.append([])  # Blank row 3
        ws.append(headers)  # Row 4
        ws.row_dimensions[4].height = 24

        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=4, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center_align

        # Data Rows
        for row_idx, r in enumerate(records, start=5):
            ws.append([
                r["employee_id"],
                r["employee_code"],
                r["name"],
                r["department"],
                r["date"],
                r["clock_in"],
                r["last_seen"],
                r["clock_out"],
                r["first_camera"],
                r["last_camera"],
                r["duration_hours"],
                f"{int(r['confidence'] * 100)}%",
                r["status"]
            ])
            ws.row_dimensions[row_idx].height = 20

            # Cell formatting & borders
            for c_idx in range(1, len(headers) + 1):
                c = ws.cell(row=row_idx, column=c_idx)
                c.font = regular_font
                c.border = thin_border
                if c_idx in [5, 6, 7, 8, 11, 12, 13]:
                    c.alignment = center_align
                else:
                    c.alignment = left_align

                # Highlight status
                if c_idx == 13:
                    if r["status"] == "PRESENT":
                        c.font = Font(name="Segoe UI", size=10, bold=True, color="008000")
                    else:
                        c.font = Font(name="Segoe UI", size=10, color="555555")

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        file_stream = io.BytesIO()
        wb.save(file_stream)
        return file_stream.getvalue()

    async def _fetch_attendance_export_data(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        employee_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetches flattened joined rows for export.
        """
        async with AsyncSessionLocal() as db:
            query = select(Attendance, Employee).join(Employee, Attendance.employee_id == Employee.id)

            if employee_id:
                query = query.where(Attendance.employee_id == employee_id)
            if department and department.upper() != "ALL":
                query = query.where(Employee.department == department)
            if date_from:
                query = query.where(Attendance.date >= date_from)
            if date_to:
                query = query.where(Attendance.date <= date_to)

            query = query.order_by(desc(Attendance.date), asc(Employee.name))
            res = await db.execute(query)
            rows = res.all()

            # Cache camera names
            cams_res = await db.execute(select(Camera.id, Camera.name))
            cam_dict = {c_id: c_name for c_id, c_name in cams_res.all()}

            results = []
            for att, emp in rows:
                c_in = att.first_seen_at.strftime("%H:%M:%S") if att.first_seen_at else "N/A"
                l_seen = att.last_seen_at.strftime("%H:%M:%S") if att.last_seen_at else "N/A"
                c_out = att.last_seen_at.strftime("%H:%M:%S") if att.status == "COMPLETED" else "On-Site"

                duration_hours = "0.0"
                if att.first_seen_at and att.last_seen_at:
                    dur_sec = (att.last_seen_at - att.first_seen_at).total_seconds()
                    duration_hours = f"{dur_sec / 3600.0:.2f}"

                results.append({
                    "employee_id": emp.id,
                    "employee_code": emp.employee_code,
                    "name": emp.name,
                    "department": emp.department,
                    "date": att.date,
                    "clock_in": c_in,
                    "last_seen": l_seen,
                    "clock_out": c_out,
                    "first_camera": cam_dict.get(att.clock_in_camera_id, att.clock_in_camera_id or "N/A"),
                    "last_camera": cam_dict.get(att.last_seen_camera_id, att.last_seen_camera_id or "N/A"),
                    "duration_hours": duration_hours,
                    "confidence": att.clock_in_confidence,
                    "status": att.status
                })

            return results

attendance_service = AttendanceService()
