import os
import json
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import uvicorn
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize FastAPI with CORS
app = FastAPI()

# CORS Configuration (expanded for local development)
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8000",
    "http://localhost:8001",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "https://telehealth-application.onrender.com"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files Setup
static_dir = os.path.abspath("static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Enhanced Firebase Config Endpoint
@app.get("/firebase-config")
async def get_firebase_config():
    try:
        # Try environment variable first (from .env)
        config_json = os.getenv("FIREBASE_CONFIG")
        
        if config_json:
            # Handle both stringified JSON and proper JSON from .env
            try:
                config = json.loads(config_json.replace("'", "\""))
            except json.JSONDecodeError:
                # If it's already proper JSON
                config = json.loads(config_json)
        else:
            # Fallback to local file for development
            config_path = Path("firebase-config.json")
            if config_path.exists():
                with open(config_path) as f:
                    config = json.load(f)
            else:
                raise ValueError(
                    "Neither FIREBASE_CONFIG env var nor firebase-config.json file found"
                )
        
        print("Loaded Firebase config successfully")
        return JSONResponse(content=config)
    except Exception as e:
        print(f"Firebase config error: {str(e)}")
        return JSONResponse(
            content={"error": "Failed to load Firebase configuration"},
            status_code=500
        )

# Robust TURN Credentials Endpoint
@app.get("/api/turn-credentials")
async def get_turn_credentials():
    try:
        # Only use paid TURN servers in production
        if os.getenv("ENVIRONMENT", "development") == "production":
            METERED_API_KEY = os.getenv("METERED_API_KEY")
            if not METERED_API_KEY:
                raise ValueError("METERED_API_KEY not configured")

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://video-call-turn-server.metered.live/api/v1/turn/credentials",
                    params={"apiKey": METERED_API_KEY},
                    timeout=10.0
                )
                response.raise_for_status()
                return response.json()
    except Exception as e:
        print(f"TURN server error (falling back to STUN): {str(e)}")

    # Default STUN servers for local development
    return JSONResponse(content={
        "iceServers": [
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"},
            {"urls": "stun:stun2.l.google.com:19302"}
        ]
    })

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"New connection. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"Disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: str, sender: WebSocket):
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except:
                    self.disconnect(connection)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast("A user disconnected", websocket)

# Serve frontend files
@app.get("/{path:path}")
async def serve_frontend(path: str):
    static_file = os.path.join(static_dir, path)
    if os.path.isfile(static_file):
        return FileResponse(static_file)
    
    # Fallback to index.html for SPA routing
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    return JSONResponse(
        content={"error": "File not found"},
        status_code=404
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(
        "video_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="debug"
    )