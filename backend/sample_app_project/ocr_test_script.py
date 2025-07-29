import os
import json
import io
from pathlib import Path
from PIL import Image
from google.cloud import vision
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Embedded credentials (same as before)
GOOGLE_CREDENTIALS = {
    "type": "service_account",
    "project_id": "ocr-visionapi-application",
    "private_key_id": "9e04697774c53f6dca557e027d4390967b09e995",
    "private_key": """-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCey9i+Q1FMX/aJ
niWowaNzoF0BghZbt07XozI8kDYxxN5XaT+PahmiaDKVa1bv+sJwH5ItdoBFs4Mm
6Mobw7tYDwrpQjbXP7kzs9Vm04lgwOFccLpUEF4klGR9itvWJTx89CfmabzDn4xW
gEBsdd6lWeVHFBReB9Ym6oT9/Lnvag3Q0Vk4AwPjTFAUPcw6rSFBdoCP27jYED3g
L8IwmSCsSPclJTp7nESVDwJ++aAri5SqSbpr6qv8W7donJgZk5LlDDQxJ6EZ9aij
0EhlvTfEYbWcq0nFkuDFCYOwYYpu7RlCH8QRlN7bMV8Fe6wGewM4Dps/P3EBAygW
tWj+PJJlAgMBAAECggEASBvJEJ0BDe2FxnhKIZfM4XSwxz6LaJqU8tbouRfDhFYh
oQ/qDPXhLh6i2bckg1Ubdk7f0kU9emlJ5SFQpcr8B8DM859dx+Dn+NJw1YC5oXX0
4EVQV1wXZAT+nQOxUE0YaqV0eO0LCsoosB8NIjNkJzHrK5uypABq/sEAI1XgGRcX
wXFl0VJRfDJhTpW9cfQ5FlkDBD9k9ioSIhtAI8OYUcDOUGkjSU+IHMvxYO37yWxA
s4HNQnSdRT0eqQxMYqoz/8aQQikMFrc2+Ts0btS5AlAmR6wkAFeBEBRkXO988bWg
TbJ1GmE3sETvI2BRgAbLHsig446kBGtF3hCZgCQ7AQKBgQDdipvraBcU+qgJE2zQ
kJKedZ1LjwJ3Uz9+jw8Qt+CsW5COeGtefyKPanR2qG8+1Fi3rwjjjwBXlxoo5mdI
/qpoIdvSNR9upk6kIaBbY9361wP32zAExuuV+j3tLP3ww/KDuaauDqFG43CzIkOi
dhru7Wqz9FtUxpIjAS30EMQYswKBgQC3ftXZJMWlj/jObVlptK/jDKf9sqbNcffD
ndAFKWk168F9/2FUHrjeoD8I+YFTGb6c2IxBoXDwQCSeskk4IQw03I984sPOznZz
2ddybSXqJf4mJywqvKCscoZR0n7njwRWvkOo5QfO3wHqTVb2kUR03OnTF9UuO2k5
TgqOqKxEhwKBgQDPO3FOazfsL+wvUTRghFwiTfKtU0EDTaP/RuLYyKgpkh1Op+YH
pvU1Imd+91/YbdnvOJQgCQxQ4s9doujKpy3P6pwtrfORFZBKiAnwcyKaGbdkimwI
i+qjiEmVKpkANssL3QXFm3nRTb+GUW7i8YeQKBW/77vfOUBJ7jiGLYjBcQKBgQCm
WVja+0gm+OdRlLZrav/NMUsWZqBrPbek4muUUl9sH6eRZzTAAv4L7XBX3YHNaVhx
bqtwUEBHvY61Q+G2/dbIEXAPgrCKyod+LW3w8Vxe8kR+KCMVN13eGBEHGnIr0G7Z
iLFj6wXyGB/vXl/JNha+bwuXcFK2D+wrpEFT5TwO/wKBgGR+N1dmTpwI2z/Rl7nF
2fakQZd+EOABy6Q4O4tdPhXXCx8Ot3AxLxoqHdM0jhMA1dNjpKPz0rJK/PGtnTTY
6v3Duhdq8yqfjNjbID9hrjfKxvrnby5qRhh+rsqf6+ke8G/L/zpeoBofg4Ln5mNl
A46xylCG2m6zYdMj3w4KlRmm
-----END PRIVATE KEY-----""",
    "client_email": "telehealth-ocr@ocr-visionapi-application.iam.gserviceaccount.com",
    "client_id": "117508885500199847808",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/telehealth-ocr%40ocr-visionapi-application.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
}

def initialize_vision_client():
    """Initialize Google Vision client with embedded credentials"""
    try:
        logger.info("Initializing Vision client...")
        
        # Write credentials to a temporary file
        temp_cred_path = Path("temp_vision_creds.json")
        with open(temp_cred_path, "w") as f:
            json.dump(GOOGLE_CREDENTIALS, f)
        
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(temp_cred_path)
        logger.info("Credentials initialized")

        # Initialize the client
        client = vision.ImageAnnotatorClient()
        logger.info("Vision client ready")
        return client

    except Exception as e:
        logger.error(f"Failed to initialize Vision client: {str(e)}")
        raise

def convert_image_to_jpeg_bytes(image_path):
    """Convert image to JPEG bytes, handling RGBA and other formats"""
    try:
        with Image.open(image_path) as img:
            if img.mode == 'RGBA':
                img = img.convert('RGB')
            
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='JPEG', quality=90)
            return img_byte_arr.getvalue()
            
    except Exception as e:
        logger.error(f"Image conversion failed: {str(e)}")
        raise

# ===== PRODUCTION-LIKE FUNCTIONALITY =====
def extract_numbers(text, capture_type='temperature'):
    """Enhanced number extraction from production code"""
    logger.debug(f"Extracting numbers from text for {capture_type}: {text[:100]}...")
    
    if not text or text == "No text found":
        return "No text detected in image"
    
    patterns = {
        'temperature': r"(\d{2}\.?\d?\s?[°℃CF])|(\d{2}\.?\d?)",
        'weight': r"(\d{2,3}\.?\d?\s?[kK][gG])|(\d{2,3}\.?\d?)"
    }
    
    matches = re.findall(patterns[capture_type], text, re.IGNORECASE)
    if matches:
        flat_matches = [m for group in matches for m in group if m]
        if flat_matches:
            value = re.sub(r"[^\d.]", "", flat_matches[0])
            try:
                num = float(value)
                if capture_type == 'temperature':
                    return f"{num}°C"
                elif capture_type == 'weight':
                    return f"{num} Kg"
                return str(value)
            except ValueError as e:
                logger.warning(f"Failed to convert number: {value}, error: {e}")
    
    return f"Could not extract {capture_type} from: {text[:50]}..."

def process_image_production_style(client, image_path, capture_type='temperature'):
    """Mimic the production code's processing pipeline"""
    try:
        # Convert image
        image_bytes = convert_image_to_jpeg_bytes(image_path)
        
        # Perform OCR - using document_text_detection like production
        image = vision.Image(content=image_bytes)
        response = client.document_text_detection(image=image)
        texts = response.text_annotations
        raw_text = texts[0].description if texts else "No text found"
        
        # Extract values like production
        extracted_value = extract_numbers(raw_text, capture_type)
        
        return {
            'raw_text': raw_text,
            'formatted_value': extracted_value,
            'confidence': "high" if "Could not extract" not in extracted_value else "low"
        }
        
    except Exception as e:
        logger.error(f"Production-style processing failed: {str(e)}")
        raise
# ===== END PRODUCTION-LIKE FUNCTIONALITY =====

def display_results(results):
    """Display results in a readable format"""
    print("\n=== PRODUCTION-STYLE RESULTS ===")
    print(f"Raw Text:\n{results['raw_text']}")
    print(f"\nFormatted Value: {results['formatted_value']}")
    print(f"Confidence: {results['confidence']}")
    print("="*40)

def main():
    try:
        # Initialize client
        client = initialize_vision_client()
        test_image_path = Path(
            r"C:\Users\bokan\Documents\Coding Projects\Kinetix Engineering Tech"
            r"\Telehealth-Application\backend\sample_app_project\Screen.png"
        )
        
        if not test_image_path.exists():
            logger.error(f"Image not found at: {test_image_path}")
            return

        # Process using production-like method
        results = process_image_production_style(
            client, 
            test_image_path,
            capture_type='temperature'  # or 'weight'
        )
        
        display_results(results)
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")

if __name__ == "__main__":
    import re  # Needed for extract_numbers
    main()