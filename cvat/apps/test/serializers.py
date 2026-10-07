# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from rest_framework import serializers


class AnnotationClassCountSerializer(serializers.Serializer):
    label = serializers.CharField(help_text="The label (class) name.")
    count = serializers.IntegerField(
        help_text="Number of LabeledShape annotations of this label in the task."
    )
