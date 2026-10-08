# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

"""
ASGI config for CVAT project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/3.2/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application
from django.core.handlers.asgi import ASGIHandler

import cvat.utils.remote_debugger as debug

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cvat.settings.development")

# get_asgi_application() runs django.setup() as a side effect. Anything that
# imports Django models (our websocket consumer/routing included) must be
# imported after this line, not before -- importing them earlier fails with
# "Apps aren't loaded yet".
django_http_app = get_asgi_application()


if debug.is_debugging_enabled():

    class DebuggerApp(ASGIHandler):
        """
        Support for VS code debugger
        """

        def __init__(self) -> None:
            super().__init__()
            self.__debugger = debug.RemoteDebugger()

        async def handle(self, *args, **kwargs):
            self.__debugger.attach_current_thread()
            return await super().handle(*args, **kwargs)

    django_http_app = DebuggerApp()

# Item 8: websocket support for live annotation-count updates. Greenfield --
# CVAT has no other websocket routes today, so this is the one place they're
# wired in, alongside the existing plain-HTTP app above.
from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from cvat.apps.test.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_http_app,
    # AuthMiddlewareStack populates scope["user"] from the session cookie --
    # the same login CVAT's REST API already uses (see item 5), not a
    # separate auth mechanism invented for this one feature.
    "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
})
