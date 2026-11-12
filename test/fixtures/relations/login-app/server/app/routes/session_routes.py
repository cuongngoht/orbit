from ..auth.session import create_session
from ..http import route


@route("POST", "/api/session")
def post_session(request):
    return create_session(request["user"], request["password"])
