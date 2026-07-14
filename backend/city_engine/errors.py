"""Domain errors. API adapters translate these into HTTP responses."""


class CityEngineError(Exception):
    """Base class for expected engine failures."""


class StateValidationError(CityEngineError):
    """A snapshot violates a structural game invariant."""


class InvalidCommandError(CityEngineError):
    """A command is unknown or malformed."""


class IllegalActionError(CityEngineError):
    """A structurally valid command is illegal in the current state."""


class StaleRevisionError(CityEngineError):
    """The caller acted on an older room revision."""
