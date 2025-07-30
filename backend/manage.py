#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

def main():
    """Run administrative tasks."""
    # Load environment variables - work with both local and deployed environments
    if Path(".env").exists():
        load_dotenv()
    
    # Configure Google Vision credentials from environment
    # Check both possible environment variable names
    vision_creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") or os.environ.get("VISION_KEY")
    
    if vision_creds_json:
        try:
            # Parse JSON credentials
            if isinstance(vision_creds_json, str):
                vision_creds = json.loads(vision_creds_json)
            else:
                vision_creds = vision_creds_json
            
            # Create config directory and save credentials
            config_dir = Path("config")
            config_dir.mkdir(exist_ok=True)
            vision_key_path = config_dir / "vision-key.json"
            
            with open(vision_key_path, "w") as f:
                json.dump(vision_creds, f)
            
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(vision_key_path.absolute())
            print(f"Google Vision credentials saved to: {vision_key_path.absolute()}")
            
        except json.JSONDecodeError as e:
            print(f"Error parsing Google Vision credentials: {e}")
        except Exception as e:
            print(f"Error setting up Google Vision credentials: {e}")

    # Set default Django settings module
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sample_app_project.settings')
    
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
        
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()