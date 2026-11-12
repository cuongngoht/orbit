from app.routes import (
    session_routes,
)


def test_post_session_returns_the_user():
    assert session_routes.post_session({"user": "a", "password": "b"}) == {"user": "a"}
