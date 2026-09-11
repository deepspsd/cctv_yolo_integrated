import json
import logging
from typing import Set
from fastapi import WebSocket

logger = logging.getLogger("websocket_manager")

class WebSocketManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, payload: dict):
        if not self.active_connections:
            return
        
        message = json.dumps({"type": event_type, "payload": payload})
        dead_connections = set()
        
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Error sending message to client: {e}")
                dead_connections.add(connection)
                
        for dead in dead_connections:
            self.disconnect(dead)

ws_manager = WebSocketManager()
