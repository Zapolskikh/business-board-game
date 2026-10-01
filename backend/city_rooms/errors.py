"""Application errors raised by the room layer."""


class RoomError(Exception):
    """Base error safe to translate into an HTTP response."""


class RoomNotFoundError(RoomError):
    """The requested room does not exist."""


class RoomConflictError(RoomError):
    """The room changed concurrently or the requested seat is unavailable."""


class RoomNameTakenError(RoomConflictError):
    """Another open room already uses this name: the list would show two identical cards."""


class RoomAccessError(RoomError):
    """The supplied room password is invalid."""


class RoomValidationError(RoomError):
    """The requested room transition is not legal."""
