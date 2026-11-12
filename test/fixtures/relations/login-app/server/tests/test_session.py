from app.auth.session import create_session


def test_a_session_needs_a_password():
    try:
        create_session("a", "")
    except ValueError:
        return
    raise AssertionError("no error")
