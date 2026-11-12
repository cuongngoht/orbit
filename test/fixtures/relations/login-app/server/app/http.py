ROUTES = {}


def route(method, path):
    def register(handler):
        ROUTES[(method, path)] = handler
        return handler
    return register
