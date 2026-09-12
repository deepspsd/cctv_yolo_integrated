import io
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, asc

from app.database import get_db
from app.models import Attendance, Employee, Camera, User
from app.dependencies import get_current_user
from app.schemas import AttendanceResponse, AttendanceSummaryResponse
from app.attendance_service import attendance_service

logger = logging.getLogger("routes.attendance")

router = APIRouter(
    prefix="/attendance",
    tags=["Automatic Attendance"],
    dependencies=[Depends(get_current_user)],
)

@router.get("", response_model=List[AttendanceResponse])
async def list_attendance(
    date: Optional[str] = None,
    date_from: Optional[str] = Query(None, alias="dateFrom"),
    date_to: Optional[str] = Query(None, alias="dateTo"),
    employee_id: Optional[str] = Query(None, alias="employeeId"),
    department: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    query = select(Attendance, Employee).join(Employee, Attendance.employee_id == Employee.id)

    if date:
        query = query.where(Attendance.date == date)
    if date_from:
        query = query.where(Attendance.date >= date_from)
    if date_to:
        query = query.where(Attendance.date <= date_to)
    if employee_id:
        query = query.where(Attendance.employee_id == employee_id)
    if department and department.upper() != "ALL":
        query = query.where(Employee.department == department)

    query = query.order_by(desc(Attendance.date), desc(Attendance.first_seen_at))
    query = query.offset(offset).limit(limit)

    res = await db.execute(query)
    rows = res.all()

    cams_res = await db.execute(select(Camera.id, Camera.name))
    cam_dict = {c_id: c_name for c_id, c_name in cams_res.all()}

    results = []
    for att, emp in rows:
        dur_hrs = "0.0"
        if att.first_seen_at and att.last_seen_at:
            sec = (att.last_seen_at - att.first_seen_at).total_seconds()
            dur_hrs = f"{sec / 3600.0:.2f}"

        results.append({
            "id": att.id,
            "employeeId": emp.id,
            "employeeCode": emp.employee_code,
            "employeeName": emp.name,
            "department": emp.department,
            "date": att.date,
            "firstSeenAt": att.first_seen_at.isoformat() if att.first_seen_at else None,
            "lastSeenAt": att.last_seen_at.isoformat() if att.last_seen_at else None,
            "clockInCameraId": att.clock_in_camera_id,
            "lastSeenCameraId": att.last_seen_camera_id,
            "clockInCameraName": cam_dict.get(att.clock_in_camera_id, att.clock_in_camera_id),
            "lastSeenCameraName": cam_dict.get(att.last_seen_camera_id, att.last_seen_camera_id),
            "clockInConfidence": att.clock_in_confidence,
            "status": att.status,
            "durationHours": dur_hrs
        })

    return results

@router.get("/summary", response_model=AttendanceSummaryResponse)
async def get_attendance_summary(
    date: Optional[str] = None
):
    """
    Returns today's or specified date's high-level attendance KPI metrics.
    """
    return await attendance_service.get_attendance_summary(date)

@router.get("/export")
async def export_attendance(
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    date_from: Optional[str] = Query(None, alias="dateFrom"),
    date_to: Optional[str] = Query(None, alias="dateTo"),
    department: Optional[str] = None,
    employee_id: Optional[str] = Query(None, alias="employeeId")
):
    """
    Exports attendance records as CSV or styled Excel spreadsheet.
    """
    today_str = datetime.now(timezone.utc).strftime("%Y%m%d")

    if format == "csv":
        csv_data = await attendance_service.export_attendance_csv(
            date_from=date_from,
            date_to=date_to,
            department=department,
            employee_id=employee_id
        )
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=attendance_{today_str}.csv"}
        )
    elif format == "xlsx":
        xlsx_bytes = await attendance_service.export_attendance_xlsx(
            date_from=date_from,
            date_to=date_to,
            department=department,
            employee_id=employee_id
        )
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=attendance_{today_str}.xlsx"}
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported export format")

@router.get("/{employee_id}", response_model=List[AttendanceResponse])
async def get_employee_attendance_history(
    employee_id: str,
    limit: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db)
):
    query = select(Attendance, Employee).join(
        Employee, Attendance.employee_id == Employee.id
    ).where(Attendance.employee_id == employee_id).order_by(desc(Attendance.date)).limit(limit)

    res = await db.execute(query)
    rows = res.all()

    cams_res = await db.execute(select(Camera.id, Camera.name))
    cam_dict = {c_id: c_name for c_id, c_name in cams_res.all()}

    results = []
    for att, emp in rows:
        dur_hrs = "0.0"
        if att.first_seen_at and att.last_seen_at:
            sec = (att.last_seen_at - att.first_seen_at).total_seconds()
            dur_hrs = f"{sec / 3600.0:.2f}"

        results.append({
            "id": att.id,
            "employeeId": emp.id,
            "employeeCode": emp.employee_code,
            "employeeName": emp.name,
            "department": emp.department,
            "date": att.date,
            "firstSeenAt": att.first_seen_at.isoformat() if att.first_seen_at else None,
            "lastSeenAt": att.last_seen_at.isoformat() if att.last_seen_at else None,
            "clockInCameraId": att.clock_in_camera_id,
            "lastSeenCameraId": att.last_seen_camera_id,
            "clockInCameraName": cam_dict.get(att.clock_in_camera_id, att.clock_in_camera_id),
            "lastSeenCameraName": cam_dict.get(att.last_seen_camera_id, att.last_seen_camera_id),
            "clockInConfidence": att.clock_in_confidence,
            "status": att.status,
            "durationHours": dur_hrs
        })
    return results
