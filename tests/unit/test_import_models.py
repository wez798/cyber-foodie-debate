"""Import schema boundaries, including full question/answer histories."""

import pytest
from pydantic import ValidationError

from src.backend.models import ConversationImportRequest


@pytest.mark.parametrize(
    "patch",
    [
        {"import_request_id": ""},
        {"import_request_id": "x" * 65},
        {"import_request_id": "bad/id"},
        {"import_request_id": None},
        {"topic": "x" * 201},
        {"messages": []},
        {"messages": [{"role": "user", "content": "x"}] * 51},
        {"messages": [{"role": "system", "content": "x"}]},
        {"messages": [{"role": "assistant", "content": "x"}]},
        {"messages": [{"role": "user", "content": " "}]},
        {"messages": [{"role": "user", "content": ""}]},
        {"messages": [{"role": "user", "content": "x" * 8001}]},
        {"messages": [{"role": "user", "content": "x" * 8000}] * 8, "topic": "x"},
        *[
            {field: "forged"}
            for field in ["owner", "source", "status", "sequence_no", "id", "mode"]
        ],
        *[
            {"messages": [{"role": "user", "content": "x", field: "forged"}]}
            for field in ["owner", "source", "status", "sequence_no", "id"]
        ],
    ],
)
def test_reject_invalid_import(patch):
    with pytest.raises(ValidationError):
        ConversationImportRequest.model_validate(
            {
                "import_request_id": "valid-1",
                "messages": [{"role": "user", "content": "x"}],
                **patch,
            }
        )


def test_limits_and_normalization():
    request = ConversationImportRequest.model_validate(
        {
            "import_request_id": "A._:-09",
            "topic": "  \n",
            "messages": [{"role": "user", "content": "😀" * 8000}] * 8,
        }
    )
    assert request.topic is None
    assert sum(len(m.content) for m in request.messages) == 64000
    full = ConversationImportRequest.model_validate(
        {
            "import_request_id": "full",
            "topic": " 食堂 ",
            "messages": [
                {"role": "user", "content": " 问题 "},
                {"role": "assistant", "content": "回答"},
            ],
        }
    )
    assert full.topic == "食堂"
    assert full.messages[0].content == " 问题 "


def test_required_fields():
    for payload in [{"messages": []}, {"import_request_id": "x"}]:
        with pytest.raises(ValidationError):
            ConversationImportRequest.model_validate(payload)
