# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from rest_framework import routers

from .views import AnnotationCountsViewSet

router = routers.DefaultRouter(trailing_slash=False)
router.register("test", AnnotationCountsViewSet, basename="test")

urlpatterns = router.urls
