from django.urls import path
from sample_app.views import TemperatureOCRView, WeightOCRView

urlpatterns = [
    path("capture-temperature/", TemperatureOCRView.as_view(), name="capture-temperature"),
    path("capture-weight/", WeightOCRView.as_view(), name="capture-weight"),
]
