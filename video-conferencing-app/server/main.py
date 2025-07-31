from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import uvicorn

app = FastAPI()

# Production-ready CORS settings
origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://192.168.2.180:3001",
    "https://video-call-turn-server.metered.live",
    "https://telehealth-application.onrender.com",
    "https://fir-rtc-521a2.web.app"  # Added your Firebase hosting domain
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/firebase-config")
async def get_firebase_config():
    return JSONResponse({
        "apiKey": os.getenv("FIREBASE_API_KEY"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"),
        "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID"),
        "databaseURL": os.getenv("FIREBASE_DATABASE_URL"),
        "experimentalForceLongPolling": True,
        "merge": True
    })

@app.get("/api/turn-credentials")
async def get_turn_credentials():
    """Endpoint for TURN server credentials"""
    return JSONResponse({
        "iceServers": [
            {
                "urls": [
                    "stun:stun.l.google.com:19302",
                    "stun:global.stun.twilio.com:3478"
                ]
            },
            {
                "urls": [
                    "turn:global.relay.metered.ca:80",
                    "turn:global.relay.metered.ca:80?transport=tcp",
                    "turn:global.relay.metered.ca:443",
                    "turns:global.relay.metered.ca:443?transport=tcp"
                ],
                "username": "2506751c38ffc2c7eaeccab9",
                "credential": "Hnz1SG7ezaCS6Jtg"
            }
        ],
        "iceTransportPolicy": "all",
        "bundlePolicy": "max-bundle",
        "rtcpMuxPolicy": "require"
    })

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8001)),
        ssl_keyfile=os.getenv("SSL_KEYFILE"),
        ssl_certfile=os.getenv("SSL_CERTFILE")
    )