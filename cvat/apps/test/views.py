# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from django.db.models import Count
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from cvat.apps.engine.models import LabeledShape, Task

from .serializers import AnnotationClassCountSerializer


@extend_schema(tags=["test"])
class AnnotationCountsViewSet(viewsets.ViewSet):
    """
    Annotation Analytics: counts of annotations per label (class) for a task.

    Counts are read directly from PostgreSQL via the Django ORM -- the same
    tables the rest of CVAT uses to store drawn shapes -- rather than from
    CVAT's ClickHouse/events analytics pipeline, which only logs user
    activity events and is not the annotation source of truth.
    """

    serializer_class = None
    # Global default permissions are [IsAuthenticated, PolicyEnforcer]; the
    # latter asserts the view declares an `iam_permission_class` backed by a
    # dedicated OPA/rego policy, which this read-only endpoint does not
    # define. Keep IsAuthenticated (-> 401 for anonymous callers) and drop
    # PolicyEnforcer here.
    permission_classes = [IsAuthenticated]

    def get_serializer(self, *args, **kwargs):
        # DRF's schema generation calls this on the viewset; ServerViewSet
        # uses the same no-op pattern for viewsets with no model queryset.
        pass

    @extend_schema(
        summary="Get the number of annotations per label for a task",
        parameters=[
            OpenApiParameter(
                "task_id", int, required=True, description="ID of the task to count annotations for."
            ),
        ],
        responses={200: AnnotationClassCountSerializer(many=True)},
    )
    @action(detail=False, methods=["GET"], url_path="annotation-counts")
    def annotation_counts(self, request):
        task_id = request.query_params.get("task_id")
        if not task_id:
            raise ValidationError("The 'task_id' query parameter is required.")
        try:
            task_id = int(task_id)
        except ValueError:
            raise ValidationError("'task_id' must be an integer.")

        try:
            task = Task.objects.get(id=task_id)
        except Task.DoesNotExist:
            raise NotFound(f"Task {task_id} does not exist.")

        # Every label defined for the task (via its project, if any) starts
        # at zero, so classes with no annotations still appear in the chart.
        counts = {label.name: 0 for label in task.get_labels()}

        # The one ORM aggregate this feature is built around: a drawn shape
        # (LabeledShape) belongs to a Job, a Job belongs to a Segment, and a
        # Segment belongs to a Task -- so this is the join path from a task
        # id to its annotations' label names.
        annotated = (
            LabeledShape.objects.filter(job__segment__task_id=task.id)
            .values("label__name")
            .annotate(count=Count("id"))
        )
        for row in annotated:
            counts[row["label__name"]] = row["count"]

        data = [{"label": name, "count": count} for name, count in counts.items()]
        serializer = AnnotationClassCountSerializer(data, many=True)
        return Response(serializer.data)
