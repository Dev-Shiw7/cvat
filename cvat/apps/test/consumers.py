# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.conf import settings

from cvat.apps.engine.models import Task
from cvat.apps.engine.permissions import TaskPermission

# Close codes in the 4000-4999 range are reserved for applications (RFC 6455);
# chosen to echo the REST endpoint's 401/403 so the two are easy to relate.
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


class AnnotationCountsConsumer(AsyncJsonWebsocketConsumer):
    """
    Item 8: tells a connected annotation-counts page when its task's
    annotations changed, so it can re-fetch. The REST endpoint
    (cvat.apps.test.views.AnnotationCountsViewSet) remains the single source
    of truth for the actual numbers -- this only carries a "go re-fetch" ping,
    the same "reuse CVAT's existing login" rule as item 5 applies here too.

    Known limitation: the task-access check below reconstructs the IAM
    context CVAT's ContextMiddleware would normally build from an HTTP
    request, but only for the common sandbox (non-organization) case. A
    websocket handshake has no request/response cycle for CVAT's
    organization-resolution logic to run against, so an org-scoped task is
    not supported here -- documented in the Plan rather than silently wrong.
    """

    async def connect(self):
        self.task_id = int(self.scope["url_route"]["kwargs"]["task_id"])
        user = self.scope.get("user")

        if user is None or not user.is_authenticated:
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        if not await self._user_can_view_task(user):
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.group_name = f"task_{self.task_id}_annotation_counts"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    @database_sync_to_async
    def _user_can_view_task(self, user) -> bool:
        try:
            task = Task.objects.get(id=self.task_id)
        except Task.DoesNotExist:
            return False

        # Mirrors cvat.apps.iam.middleware's own privilege resolution, since
        # that middleware only runs for HTTP requests, not this handshake.
        iam_roles = {role: priority for priority, role in enumerate(settings.IAM_ROLES)}
        groups = list(user.groups.filter(name__in=list(iam_roles.keys())))
        groups.sort(key=lambda group: iam_roles[group.name])
        privilege = groups[0].name if groups else None

        iam_context = {
            "user_id": user.id,
            "group_name": privilege,
            "org_specified": False,
            "org_id": None,
            "org_slug": None,
            "org_owner_id": None,
            "org_role": None,
        }

        permission = TaskPermission.create_scope_view(None, task, iam_context=iam_context)
        return permission.check_access().allow

    async def counts_changed(self, event):
        # Invoked when dataset_manager broadcasts a "counts.changed" message
        # to this task's group (see dataset_manager/task.py).
        await self.send_json({"type": "counts_changed", "task_id": self.task_id})
