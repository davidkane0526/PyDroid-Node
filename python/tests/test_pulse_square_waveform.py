import pytest

from pydroid_flow.engine_parts.pulse_nodes import _pulse_square_waveform


def compact(frame):
    return frame[["time_s", "voltage_V", "state"]].values.tolist()


def test_square_waveform_single_high_low_high_cycle():
    result = _pulse_square_waveform({
        "highVoltage": 5,
        "lowVoltage": 0,
        "highTime": 2,
        "lowTime": 3,
        "repeatCount": 1,
        "startLevel": "high",
        "timeStart": 0,
    })
    assert result.columns.tolist() == ["sequence", "time_s", "voltage_V", "state"]
    assert compact(result) == [[0.0, 5.0, "high"], [2.0, 0.0, "low"], [5.0, 5.0, "high"]]


def test_square_waveform_repeats_continuously_without_auxiliary_nodes():
    result = _pulse_square_waveform({
        "highVoltage": 5,
        "lowVoltage": 0,
        "highTime": 1,
        "lowTime": 1,
        "repeatCount": 3,
        "startLevel": "high",
    })
    assert result["voltage_V"].tolist() == [5.0, 0.0, 5.0, 0.0, 5.0, 0.0, 5.0]
    assert result["time_s"].tolist() == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]


def test_square_waveform_supports_arbitrary_high_low_levels():
    result = _pulse_square_waveform({
        "highVoltage": 1.25,
        "lowVoltage": -2.5,
        "highTime": 0.5,
        "lowTime": 0.25,
        "repeatCount": 1,
    })
    assert compact(result) == [[0.0, 1.25, "high"], [0.5, -2.5, "low"], [0.75, 1.25, "high"]]


def test_square_waveform_can_start_low():
    result = _pulse_square_waveform({
        "highVoltage": 5,
        "lowVoltage": 0,
        "highTime": 2,
        "lowTime": 1,
        "repeatCount": 1,
        "startLevel": "low",
        "timeStart": 4,
    })
    assert compact(result) == [[4.0, 0.0, "low"], [5.0, 5.0, "high"], [7.0, 0.0, "low"]]


def test_square_waveform_total_time_continues_period_and_closes_at_requested_end():
    result = _pulse_square_waveform({
        "highVoltage": 5,
        "lowVoltage": 0,
        "highTime": 2,
        "lowTime": 1,
        "repeatCount": 1,
        "startLevel": "high",
        "timeStart": 10,
        "totalTime": 7.5,
    })
    assert compact(result) == [
        [10.0, 5.0, "high"],
        [12.0, 0.0, "low"],
        [13.0, 5.0, "high"],
        [15.0, 0.0, "low"],
        [16.0, 5.0, "high"],
        [17.5, 5.0, "high"],
    ]


@pytest.mark.parametrize(
    "params,message",
    [
        ({"highTime": 0}, "highTime and lowTime"),
        ({"lowTime": -1}, "highTime and lowTime"),
        ({"repeatCount": 1.5}, "positive integer"),
        ({"repeatCount": 0}, "positive integer"),
        ({"startLevel": "middle"}, "startLevel"),
        ({"totalTime": -1}, "totalTime"),
    ],
)
def test_square_waveform_rejects_invalid_parameters(params, message):
    with pytest.raises(ValueError, match=message):
        _pulse_square_waveform(params)
