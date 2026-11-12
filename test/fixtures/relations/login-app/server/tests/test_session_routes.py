from app.routes.session_routes import post_session


def test_post_session_returns_the_user():
    assert post_session({"user": "a", "password": "b"}) == {"user": "a"}
