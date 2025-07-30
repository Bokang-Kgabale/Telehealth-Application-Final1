"""
URL configuration for sample_app_project project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
"""
URL configuration for sample_app_project project.
"""

"""
URL configuration for sample_app_project project.
"""

from django.urls import path
from django.http import JsonResponse
from .views import upload_image, get_captured_data, health_check

def root_handler(request):
    """Root URL handler for health checks"""
    return JsonResponse({
        'status': 'active',
        'service': 'Telehealth OCR Backend',
        'version': '1.0.0'
    })

urlpatterns = [
    path('', root_handler, name='root'),  # Handle root path
    path('health/', health_check, name='health-check'),
    path('api/upload/', upload_image, name='upload-image'),
    path('api/get-data/', get_captured_data, name='get-data'),
]
