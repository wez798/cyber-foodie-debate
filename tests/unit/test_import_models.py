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


def test_confirmation_identity_is_required_and_not_part_of_original_fingerprint():
    from uuid import uuid4
    from src.backend.models import ConfirmedImportRequest
    from src.backend.api.conversation_router import import_content
    from src.backend.services.conversation_service import import_fingerprint

    body = {
        "import_request_id": "snapshot",
        "topic": " 食堂 ",
        "messages": [{"role": "user", "content": " 午饭 "}],
    }
    for identity in [{}, {"expected_user_id": "invalid"}, {"expected_user_id": None}]:
        with pytest.raises(ValidationError):
            ConfirmedImportRequest.model_validate({**body, **identity})
    first = ConfirmedImportRequest.model_validate({**body, "expected_user_id": uuid4()})
    second = ConfirmedImportRequest.model_validate(
        {**body, "expected_user_id": uuid4()}
    )
    original = ConversationImportRequest.model_validate(body)
    assert import_fingerprint(import_content(first)) == import_fingerprint(original)
    assert import_fingerprint(import_content(second)) == import_fingerprint(original)
