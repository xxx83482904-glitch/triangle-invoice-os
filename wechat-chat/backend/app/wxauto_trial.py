"""Read a local, redacted compatibility report; never enable an adapter from it."""
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


TrialError = Literal[
    "dependency_missing", "unsupported_package", "unsupported_os",
    "privacy_defaults_not_disabled", "main_window_not_found", "control_timeout",
    "input_disabled", "probe_failed", "probe_timeout", "read_failed",
]


class Attempt(BaseModel):
    variant: Literal["en", "cn", "international"]
    initialized: bool = False
    read_attempted: bool = False
    session_count: int | None = Field(default=None, ge=0, le=100000)
    visible_message_count: int | None = Field(default=None, ge=0, le=100000)
    error_code: TrialError | None = None
    blocked_python_network_operations: int = Field(default=0, ge=0)
    elapsed_seconds: float = Field(default=0, ge=0, le=60)
    failure_stage: Literal["package", "window_inventory", "initialize", "sessions", "messages"] | None = None
    missing_control_type: Literal["ButtonControl", "EditControl", "ListControl", "ListItemControl", "PaneControl",
                                  "TextControl", "WindowControl", "ToolBarControl", "TabControl", "MenuControl"] | None = None
    selector_has_name: bool = False
    selector_name_empty: bool = False
    selector_has_class: bool = False

    @model_validator(mode="after")
    def consistent(self):
        if not self.error_code and (not self.initialized or not self.read_attempted
                                    or self.session_count is None or self.visible_message_count is None):
            raise ValueError("incomplete_trial")
        return self


class FreeTrialReport(BaseModel):
    schema_version: Literal[1] = 1
    checked_at: datetime
    package_version: Literal["41.1.7"] | None = None
    wechat_version: str | None = Field(default=None, pattern=r"^\d{1,3}(\.\d{1,5}){3}$")
    node_count: int | None = Field(default=None, ge=0, le=500)
    interactive_node_count: int | None = Field(default=None, ge=0, le=500)
    attempts: list[Attempt] = Field(min_length=3, max_length=3)

    @field_validator("checked_at")
    @classmethod
    def aware_date(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timezone_required")
        return value

    @field_validator("attempts")
    @classmethod
    def distinct_variants(cls, value):
        if {a.variant for a in value} != {"en", "cn", "international"}:
            raise ValueError("missing_variant")
        return value


def read_report(path: Path):
    try:
        # Read at most the limit, even if a local process is still writing a file.
        with path.open("rb") as stream:
            content = stream.read(16385)
        if len(content) > 16384:
            raise ValueError("report_too_large")
        report = FreeTrialReport.model_validate_json(content)
        # Serialize known fields only. Library output, exception text, paths,
        # chat names and message contents are never returned by this API.
        return {"state": "available", "report": report.model_dump(mode="json")}
    except (OSError, ValueError):
        return {"state": "unavailable", "report": None}
