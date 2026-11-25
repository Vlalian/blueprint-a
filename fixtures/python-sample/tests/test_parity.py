from sample.parity import is_even


def test_three_is_odd():
    assert not is_even(3)


def test_two_and_four_are_even():
    assert is_even(2)
    assert is_even(4)
