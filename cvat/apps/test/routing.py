# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from django.urls import re_path

from .consumers import AnnotationCountsConsumer

websocket_urlpatterns = [
    re_path(
        r"^ws/test/annotation-counts/(?P<task_id>\d+)/?$",
        AnnotationCountsConsumer.as_asgi(),
    ),
]
