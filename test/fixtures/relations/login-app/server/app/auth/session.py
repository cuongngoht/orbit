SESSIONS = {}


def create_session(user, password):
    if not user or not password:
        raise ValueError("a session needs a user and a password")
    SESSIONS[user] = True
    return {"user": user}
