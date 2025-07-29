#!/usr/bin/env bash
set -o errexit

# Install dependencies and run essential setup
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate
