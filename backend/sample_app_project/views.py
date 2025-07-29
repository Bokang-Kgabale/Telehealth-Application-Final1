import os
import json
import io
import re
import logging
import traceback
import firebase_admin
from firebase_admin import credentials, db
from google.cloud import vision
from PIL import Image
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('telehealth.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global variables for services
vision_client = None
firebase_initialized = False

def initialize_services():
    """Initialize Firebase and Google Vision services"""
    global vision_client, firebase_initialized
    
    try:
        # Initialize Firebase if not already done
        if not firebase_initialized:
            firebase_creds_json = os.environ.get('FIREBASE_CREDENTIALS_JSON')
            firebase_url = os.environ.get('FIREBASE_DATABASE_URL')
            
            if not firebase_creds_json or not firebase_url:
                raise ValueError("Missing Firebase credentials or database URL")
            
            firebase_creds = credentials.Certificate(json.loads(firebase_creds_json))
            firebase_admin.initialize_app(
                firebase_creds,
                {'databaseURL': firebase_url}
            )
            firebase_initialized = True
            logger.info("Firebase initialized successfully")
        
        # Initialize Google Vision
        if vision_client is None:
            vision_creds_json = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON')
            if vision_creds_json:
                # Create temporary credentials file
                import tempfile
                with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as f:
                    f.write(vision_creds_json)
                    temp_creds_path = f.name
                
                os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = temp_creds_path
                vision_client = vision.ImageAnnotatorClient()
                logger.info("Google Vision initialized successfully")
            else:
                raise ValueError("Missing Google Vision credentials")
                
        return True
    except Exception as e:
        logger.error(f"Service initialization failed: {str(e)}")
        return False

class OCRService:
    PATTERNS = {
        'temperature': r"(\d{2}\.?\d?\s?[°℃CF])|(\d{2}\.?\d?)",
        'weight': r"(\d{2,3}\.?\d?\s?[kK][gG])|(\d{2,3}\.?\d?)"
    }

    @classmethod
    def extract_value(cls, text, capture_type):
        """Extract formatted value from OCR text"""
        if not text or text == "No text found":
            return None
        
        matches = re.findall(cls.PATTERNS[capture_type], text, re.IGNORECASE)
        flat_matches = [m for group in matches for m in group if m]
        
        if not flat_matches:
            return None
            
        value = re.sub(r"[^\d.]", "", flat_matches[0])
        try:
            num = float(value)
            return f"{num}°C" if capture_type == 'temperature' else f"{num} Kg"
        except ValueError:
            return None

    @classmethod
    def process_image(cls, image_bytes, capture_type):
        """Process image with Google Vision OCR"""
        try:
            if not vision_client:
                raise Exception("Vision client not initialized")
            
            image = vision.Image(content=image_bytes)
            response = vision_client.document_text_detection(image=image)
            
            if response.error.message:
                raise Exception(f"Vision API error: {response.error.message}")
                
            texts = response.text_annotations
            raw_text = texts[0].description if texts else "No text found"
            formatted_value = cls.extract_value(raw_text, capture_type)
            
            return {
                'raw_text': raw_text,
                'formatted_value': formatted_value or f"No {capture_type} detected",
                'confidence': 'high' if formatted_value else 'low',
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"OCR processing failed: {str(e)}")
            raise

def save_to_firebase(room_id, capture_type, data):
    """Save data to Firebase"""
    try:
        path = f'telehealth_data/{room_id}/{capture_type}'
        ref = db.reference(path)
        ref.set(data)
        logger.info(f"Saved {capture_type} data to Firebase for room {room_id}")
    except Exception as e:
        logger.error(f"Firebase save failed: {str(e)}")
        raise

@csrf_exempt
@require_http_methods(["POST"])
def upload_image(request):
    """Handle image upload and OCR processing"""
    request_id = f"req-{datetime.now().timestamp()}"
    logger.info(f"[{request_id}] Processing upload request")
    
    try:
        # Initialize services if needed
        if not initialize_services():
            raise Exception("Failed to initialize required services")
        
        # Validate request
        if not request.FILES.get('image'):
            raise ValueError("No image file uploaded")
        
        image_file = request.FILES['image']
        capture_type = request.POST.get('type', 'temperature')
        room_id = request.POST.get('roomId', 'default-room')
        
        logger.info(f"[{request_id}] Processing {capture_type} for room {room_id}")
        
        # Process image
        try:
            # Convert image to JPEG bytes
            with Image.open(image_file) as img:
                if img.mode == 'RGBA':
                    img = img.convert('RGB')
                
                img_bytes = io.BytesIO()
                img.save(img_bytes, format='JPEG', quality=90, optimize=True)
                image_bytes = img_bytes.getvalue()
        except Exception as e:
            raise ValueError(f"Invalid image file: {str(e)}")
        
        # Perform OCR
        ocr_results = OCRService.process_image(image_bytes, capture_type)
        
        # Save to Firebase
        save_to_firebase(room_id, capture_type, ocr_results)
        
        # Return success response
        response_data = {
            'status': 'success',
            'data': {
                'room_id': room_id,
                'capture_type': capture_type,
                **ocr_results
            },
            'request_id': request_id
        }
        
        logger.info(f"[{request_id}] Upload processed successfully")
        return JsonResponse(response_data)
        
    except Exception as e:
        logger.error(f"[{request_id}] Upload failed: {str(e)}")
        return JsonResponse({
            'status': 'error',
            'message': str(e),
            'request_id': request_id
        }, status=400)

@require_http_methods(["GET"])
def get_captured_data(request):
    """Retrieve captured data from Firebase"""
    try:
        room_id = request.GET.get("roomId")
        if not room_id:
            raise ValueError("Missing roomId parameter")
        
        # Get data from Firebase
        temperature_ref = db.reference(f'telehealth_data/{room_id}/temperature')
        weight_ref = db.reference(f'telehealth_data/{room_id}/weight')
        
        temperature_data = temperature_ref.get()
        weight_data = weight_ref.get()
        
        return JsonResponse({
            'status': 'success',
            'data': {
                'temperature': temperature_data,
                'weight': weight_data
            }
        })
    except Exception as e:
        logger.error(f"Data retrieval failed: {str(e)}")
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=400)

@require_http_methods(["GET"])
def health_check(request):
    """Health check endpoint"""
    services_ok = initialize_services()
    return JsonResponse({
        'status': 'healthy' if services_ok else 'unhealthy',
        'timestamp': datetime.utcnow().isoformat(),
        'services': {
            'firebase': 'active' if firebase_initialized else 'inactive',
            'vision': 'active' if vision_client else 'inactive'
        }
    })