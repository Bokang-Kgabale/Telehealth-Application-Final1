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
        logging.StreamHandler()  # Only console logging for Render
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
                logger.error("Missing Firebase credentials or database URL")
                return False
            
            try:
                firebase_creds = credentials.Certificate(json.loads(firebase_creds_json))
                firebase_admin.initialize_app(
                    firebase_creds,
                    {'databaseURL': firebase_url}
                )
                firebase_initialized = True
                logger.info("Firebase initialized successfully")
            except Exception as e:
                logger.error(f"Firebase initialization failed: {str(e)}")
                return False
        
        # Initialize Google Vision
        if vision_client is None:
            # Check for credentials in environment
            vision_creds_json = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') or os.environ.get('VISION_KEY')
            if vision_creds_json:
                try:
                    # Create temporary credentials file
                    import tempfile
                    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as f:
                        if isinstance(vision_creds_json, str):
                            f.write(vision_creds_json)
                        else:
                            json.dump(vision_creds_json, f)
                        temp_creds_path = f.name
                    
                    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = temp_creds_path
                    vision_client = vision.ImageAnnotatorClient()
                    logger.info("Google Vision initialized successfully")
                except Exception as e:
                    logger.error(f"Google Vision initialization failed: {str(e)}")
                    return False
            else:
                logger.error("Missing Google Vision credentials")
                return False
                
        return True
    except Exception as e:
        logger.error(f"Service initialization failed: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False

class OCRService:
    PATTERNS = {
        'temperature': r"(\d{2}\.?\d?\s?[°℃CF])|(\d{2}\.?\d?)",
        'weight': r"(\d{2,3}\.?\d?\s?[kK][gG])|(\d{2,3}\.?\d?)",
        'glucose': r"(\d{2,3}\.?\d?\s?(mg/dL|mmol/L)?)|(\d{2,3}\.?\d?)",
        'blood_pressure': r"\b(\d{2,3})[\/\-](\d{2,3})\b",
        'endoscope': r".+"
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

        value = re.sub(r"[^\d./]", "", flat_matches[0])

        try:
            if capture_type == 'temperature':
                num = float(value)
                return f"{num}°C"
            elif capture_type == 'weight':
                num = float(value)
                return f"{num} Kg"
            elif capture_type == 'glucose':
                num = float(value)
                return f"{num} mg/dL"
            elif capture_type == 'blood_pressure':
                return f"{value} mmHg"
            elif capture_type == 'endoscope':
                return "Endoscopic data captured"
            else:
                return value
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
        if not firebase_initialized:
            raise Exception("Firebase not initialized")
            
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
        if not initialize_services():
            raise Exception("Failed to initialize Firebase")
            
        room_id = request.GET.get("roomId")
        if not room_id:
            raise ValueError("Missing roomId parameter")
        
        # Get data from Firebase
        temperature_ref = db.reference(f'telehealth_data/{room_id}/temperature')
        weight_ref = db.reference(f'telehealth_data/{room_id}/weight')
        glucose_ref = db.reference(f'telehealth_data/{room_id}/glucose')
        blood_pressure = db.reference(f'telehealth_data/{room_id}/blood_pressure')
        endoscope_ref = db.reference(f'telehealth_data/{room_id}/endoscope')
        
        temperature_data = temperature_ref.get()
        weight_data = weight_ref.get()
        glucose_data = glucose_ref.get()
        blood_pressure_data = blood_pressure.get()
        endoscope_data = endoscope_ref.get()
        
        return JsonResponse({
            'status': 'success',
            'data': {
                'temperature': temperature_data,
                'weight': weight_data,
                'glucose': glucose_data,
                'blood_pressure': blood_pressure_data,
                'endoscope': endoscope_data
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
    try:
        services_ok = initialize_services()
        return JsonResponse({
            'status': 'healthy' if services_ok else 'unhealthy',
            'timestamp': datetime.utcnow().isoformat(),
            'services': {
                'firebase': 'active' if firebase_initialized else 'inactive',
                'vision': 'active' if vision_client else 'inactive'
            },
            'environment_vars': {
                'firebase_creds': 'present' if os.environ.get('FIREBASE_CREDENTIALS_JSON') else 'missing',
                'firebase_url': 'present' if os.environ.get('FIREBASE_DATABASE_URL') else 'missing',
                'vision_creds': 'present' if (os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') or os.environ.get('VISION_KEY')) else 'missing'
            }
        })
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return JsonResponse({
            'status': 'error',
            'message': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }, status=500)

@require_http_methods(["GET"])
def debug_env(request):
    """Debug endpoint to check environment variables"""
    try:
        env_status = {
            'FIREBASE_CREDENTIALS_JSON': {
                'exists': bool(os.environ.get('FIREBASE_CREDENTIALS_JSON')),
                'length': len(os.environ.get('FIREBASE_CREDENTIALS_JSON', '')) if os.environ.get('FIREBASE_CREDENTIALS_JSON') else 0,
                'is_valid_json': False
            },
            'FIREBASE_DATABASE_URL': {
                'exists': bool(os.environ.get('FIREBASE_DATABASE_URL')),
                'value': os.environ.get('FIREBASE_DATABASE_URL', 'NOT_SET')
            },
            'GOOGLE_APPLICATION_CREDENTIALS_JSON': {
                'exists': bool(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON')),
                'length': len(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON', '')) if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') else 0,
                'is_valid_json': False
            },
            'VISION_KEY': {
                'exists': bool(os.environ.get('VISION_KEY')),
                'length': len(os.environ.get('VISION_KEY', '')) if os.environ.get('VISION_KEY') else 0,
                'is_valid_json': False
            }
        }
        
        # Test JSON parsing
        firebase_creds = os.environ.get('FIREBASE_CREDENTIALS_JSON')
        if firebase_creds:
            try:
                json.loads(firebase_creds)
                env_status['FIREBASE_CREDENTIALS_JSON']['is_valid_json'] = True
            except:
                env_status['FIREBASE_CREDENTIALS_JSON']['is_valid_json'] = False
        
        vision_creds = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') or os.environ.get('VISION_KEY')
        if vision_creds:
            try:
                json.loads(vision_creds)
                key_name = 'GOOGLE_APPLICATION_CREDENTIALS_JSON' if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') else 'VISION_KEY'
                env_status[key_name]['is_valid_json'] = True
            except:
                key_name = 'GOOGLE_APPLICATION_CREDENTIALS_JSON' if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON') else 'VISION_KEY'
                env_status[key_name]['is_valid_json'] = False
        
        return JsonResponse({
            'status': 'debug',
            'environment_variables': env_status,
            'timestamp': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'message': str(e),
            'traceback': traceback.format_exc()
        }, status=500)