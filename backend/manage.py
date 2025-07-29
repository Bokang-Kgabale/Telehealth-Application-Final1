#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

def main():
    """Run administrative tasks."""
    # Set the base path to your backend directory
    backend_path = Path("C:/Users/bokan/Documents/Coding Projects/Kinetix Engineering Tech/Telehealth-Application/backend")
    
    # Load environment variables from specific .env path
    env_path = backend_path / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        print(f"Warning: Could not find .env file at {env_path}")

    # Configure Google Vision credentials from environment
    vision_creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if vision_creds_json:
        try:
            # Try to parse as JSON string first
            vision_creds = json.loads(vision_creds_json)
            vision_key_path = backend_path / "config/vision-key.json"
            vision_key_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(vision_key_path, "w") as f:
                json.dump(vision_creds, f)
            
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(vision_key_path)
            print(f"Google Vision credentials saved to: {vision_key_path}")
        except json.JSONDecodeError:
            # If parsing fails, treat as file path
            cred_path = Path(vision_creds_json)
            if not cred_path.is_absolute():
                cred_path = backend_path / cred_path
                
            if cred_path.exists():
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(cred_path)
                print(f"Using Google Vision credentials from: {cred_path}")
            else:
                print(f"Warning: Google Vision credentials not found at: {cred_path}")

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