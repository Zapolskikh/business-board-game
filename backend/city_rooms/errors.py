"""Application errors raised by the room layer."""


class RoomError(Exception):
    """Base error safe to translate into an HTTP response."""


class RoomNotFoundError(RoomError):
    """The requested room does not exist."""


class RoomConflictError(RoomError):
    """The room changed concurrently or the requested seat is unavailable."""


class RoomAccessError(RoomError):
    """The supplied room password is invalid."""


class RoomValidationError(RoomError):
    """The requested room transition is not legal."""
