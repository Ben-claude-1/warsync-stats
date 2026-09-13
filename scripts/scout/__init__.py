"""warsync scout sub-tasks. Each module exposes `run(ctx) -> dict`.

`ctx` is a dict carrying:
    adb: str         path to adb binary
    device: str      adb serial of the AVD
    session_started: float

Each task is responsible for its own throttling, idempotency,
and error handling. Tasks should NEVER raise — they return a
status dict and log internally.
"""
