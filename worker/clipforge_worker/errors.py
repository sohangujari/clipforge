class UserError(Exception):
    """A failure the user can act on. The message is shown in the UI as-is."""


class Cancelled(Exception):
    """The user cancelled the job."""
