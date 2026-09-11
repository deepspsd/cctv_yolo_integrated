import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

from app.main import app
from app.database import Base, get_db
from app.models import Camera, CameraStatusEnum, User, UserRoleEnum, StreamSession
from app.security import encrypt_credential, decrypt_credential, mask_rtsp_url
from app.auth import hash_password
from app.dependencies import get_current_user

# Test in-memory SQLite DB
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

TestingSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

mock_admin = User(
    id="test-admin-id",
    name="Test Admin",
    email="admin@test.com",
    hashed_password=hash_password("AdminPass123!"),
    role=UserRoleEnum.ADMINISTRATOR,
    facility="Main Mill",
    is_active=True
)

async def override_get_current_user():
    return mock_admin

@pytest_asyncio.fixture(autouse=True)
async def init_db():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        session.add(mock_admin)
        await session.commit()

    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)

@pytest.mark.asyncio
async def test_security_functions():
    plain = "SuperSecret_P@ssword123!"
    encrypted = encrypt_credential(plain)
    assert encrypted != plain
    decrypted = decrypt_credential(encrypted)
    assert decrypted == plain

    url = "rtsp://admin:mypassword123@192.168.1.100:554/live/ch0"
    masked = mask_rtsp_url(url)
    assert "mypassword123" not in masked
    assert "••••••" in masked
    assert "admin:" in masked
    assert "@192.168.1.100" in masked

@pytest.mark.asyncio
async def test_create_camera_and_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "name": "Test Entrance Camera",
            "zone": "GATE A",
            "rtspUrl": "rtsp://operator:Secret123@192.168.1.50:554/ch0",
            "username": "operator",
            "password": "Secret123"
        }
        res = await client.post("/api/cameras", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Test Entrance Camera"
        assert data["zone"] == "GATE A"
        assert "Secret123" not in data["rtspUrl"]
        assert "••••••" in data["rtspUrl"]
        assert "password" not in data
        assert data["code"].startswith("CAM-")

        cam_id = data["id"]

        get_res = await client.get(f"/api/cameras/{cam_id}")
        assert get_res.status_code == 200
        get_data = get_res.json()
        assert get_data["id"] == cam_id
        assert get_data["name"] == "Test Entrance Camera"

        list_res = await client.get("/api/cameras")
        assert list_res.status_code == 200
        cams = list_res.json()
        assert len(cams) >= 1
        assert any(c["id"] == cam_id for c in cams)

@pytest.mark.asyncio
async def test_duplicate_name_and_invalid_rtsp():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "name": "Unique Camera Name",
            "zone": "CUTTING",
            "rtspUrl": "rtsp://192.168.1.200:554/live",
            "username": "admin"
        }
        res1 = await client.post("/api/cameras", json=payload)
        assert res1.status_code == 201

        res2 = await client.post("/api/cameras", json=payload)
        assert res2.status_code == 400
        assert "already exists" in res2.json()["detail"]

        invalid_payload = {
            "name": "HTTP Camera",
            "zone": "CUTTING",
            "rtspUrl": "http://192.168.1.200:8080/mjpeg",
            "username": "admin"
        }
        res3 = await client.post("/api/cameras", json=invalid_payload)
        assert res3.status_code == 400
        assert "RTSP URL must begin with rtsp://" in res3.json()["detail"]

@pytest.mark.asyncio
async def test_edit_camera_with_user_authentication():
    """
    Verifies that camera edit requires valid user login and password.
    If wrong -> rejected with 401.
    If correct -> updated in SQLite database.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_res = await client.post("/api/cameras", json={
            "name": "Spinning Cam 01",
            "zone": "SPINNING",
            "rtspUrl": "rtsp://192.168.2.10:554/live",
            "username": "admin"
        })
        assert create_res.status_code == 201
        cam_id = create_res.json()["id"]

        # 1. Edit without user credentials -> 401
        no_auth_res = await client.put(f"/api/cameras/{cam_id}", json={
            "name": "Hacked Camera Name",
            "zone": "HACKED"
        })
        assert no_auth_res.status_code == 401

        # 2. Edit with wrong password -> 401
        wrong_pass_res = await client.put(f"/api/cameras/{cam_id}", json={
            "name": "Wrong Pass Cam",
            "zone": "SPINNING",
            "userLogin": "admin@test.com",
            "userPassword": "IncorrectPassword!"
        })
        assert wrong_pass_res.status_code == 401
        assert "Authentication failed" in wrong_pass_res.json()["detail"]

        # 3. Edit with correct credentials -> 200 OK & database modified
        valid_res = await client.put(f"/api/cameras/{cam_id}", json={
            "name": "Spinning Cam 01 - Renamed",
            "zone": "WEAVING",
            "userLogin": "admin@test.com",
            "userPassword": "AdminPass123!"
        })
        assert valid_res.status_code == 200
        updated_data = valid_res.json()
        assert updated_data["name"] == "Spinning Cam 01 - Renamed"
        assert updated_data["zone"] == "WEAVING"

        # Verify persisted in database
        async with TestingSessionLocal() as session:
            db_cam = await session.get(Camera, cam_id)
            assert db_cam is not None
            assert db_cam.name == "Spinning Cam 01 - Renamed"
            assert db_cam.zone == "WEAVING"

@pytest.mark.asyncio
async def test_camera_query_filtering():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/cameras", json={
            "name": "Dock Alpha Entrance",
            "zone": "DOCK 01",
            "rtspUrl": "rtsp://192.168.4.10:554/live"
        })
        await client.post("/api/cameras", json={
            "name": "Weave Floor Loom 4",
            "zone": "WEAVING",
            "rtspUrl": "rtsp://192.168.5.10:554/live"
        })

        # Filter by zone
        res_dock = await client.get("/api/cameras?zone=DOCK%2001")
        assert res_dock.status_code == 200
        assert len(res_dock.json()) == 1
        assert res_dock.json()[0]["zone"] == "DOCK 01"

        # Filter by search term
        res_search = await client.get("/api/cameras?search=Loom")
        assert res_search.status_code == 200
        assert len(res_search.json()) == 1
        assert res_search.json()[0]["name"] == "Weave Floor Loom 4"

@pytest.mark.asyncio
async def test_stream_sessions_and_summary():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_res = await client.post("/api/cameras", json={
            "name": "Summary Stream Cam",
            "zone": "PACKING",
            "rtspUrl": "rtsp://192.168.2.88:554/stream"
        })
        cam_id = create_res.json()["id"]

        # Check summary endpoint
        sum_res = await client.get("/api/cameras/summary")
        assert sum_res.status_code == 200
        sum_data = sum_res.json()
        assert sum_data["total"] >= 1
        assert "activeViewers" in sum_data

        # Start stream session
        start_res = await client.post(f"/api/cameras/{cam_id}/stream/start")
        assert start_res.status_code == 200
        start_data = start_res.json()
        assert "sessionId" in start_data
        assert "whepUrl" in start_data
        sess_id = start_data["sessionId"]

        # Stop stream session
        stop_res = await client.post(f"/api/cameras/{cam_id}/stream/stop", json={"sessionId": sess_id})
        assert stop_res.status_code == 200
        assert stop_res.json()["status"] == "stopped"

        # Delete camera
        del_res = await client.delete(f"/api/cameras/{cam_id}")
        assert del_res.status_code == 204

@pytest.mark.asyncio
async def test_health_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert "database" in data
        assert "streaming_service" in data
        assert "camera_health_manager" in data
