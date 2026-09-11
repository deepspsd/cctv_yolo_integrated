import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.database import Base, get_db
from app.dependencies import get_current_user

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

@pytest_asyncio.fixture(autouse=True)
async def init_db():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides.pop(get_current_user, None)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)

@pytest.mark.asyncio
async def test_auth_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Unauthenticated /api/auth/me should fail 401
        res = await client.get("/api/auth/me")
        assert res.status_code == 401

        # 2. Register user
        register_payload = {
            "name": "Surveillance Operator One",
            "email": "operator1@priyatextiles.com",
            "password": "SecurePassword123!",
            "confirm_password": "SecurePassword123!",
            "role": "Surveillance Operator",
            "facility": "Weaving Unit 1",
            "badge_id": "OP-991"
        }
        res = await client.post("/api/auth/register", json=register_payload)
        assert res.status_code == 201
        data = res.json()
        assert data["user"]["email"] == "operator1@priyatextiles.com"
        assert "access_token" in data
        reg_token = data["access_token"]

        # 3. Duplicate register should fail 409
        res_dup = await client.post("/api/auth/register", json=register_payload)
        assert res_dup.status_code == 409

        # 4. Login with correct credentials
        login_payload = {
            "username": "operator1@priyatextiles.com",
            "password": "SecurePassword123!"
        }
        res_login = await client.post("/api/auth/login", json=login_payload)
        assert res_login.status_code == 200
        login_data = res_login.json()
        access_token = login_data["access_token"]
        assert access_token

        # 5. Access /api/auth/me with Bearer token
        headers = {"Authorization": f"Bearer {access_token}"}
        res_me = await client.get("/api/auth/me", headers=headers)
        assert res_me.status_code == 200
        assert res_me.json()["email"] == "operator1@priyatextiles.com"

        # 6. Login with incorrect password should fail 401
        res_bad_login = await client.post("/api/auth/login", json={
            "username": "operator1@priyatextiles.com",
            "password": "WrongPassword!"
        })
        assert res_bad_login.status_code == 401

        # 7. Logout
        res_logout = await client.post("/api/auth/logout", headers=headers)
        assert res_logout.status_code == 204
